import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, ToolCall, AgentType, OutboundMessageJob } from "../types.js";
import { buildSystemPrompt, buildContactContext } from "../../agent/prompts.js";
import { contactLookup } from "../../agent/tools/contact-lookup.js";
import { contactUpdate } from "../../agent/tools/contact-update.js";
import { findContactByPhone, deleteContactByPhone } from "../../contacts/index.js";
import { getMissingRequiredFields } from "../../contacts/state-machine.js";
import { addJob } from "../../queue/client.js";
import { createCorrelationId } from "../../observability/logger.js";

/**
 * Conversation Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "conversation",
  name: "Conversation Agent",
  description:
    "Handles natural language conversations with contacts, collects information, and coordinates follow-ups.",
  temperature: 0.7,
};

/**
 * ConversationAgent - Handles natural language dialog with contacts
 *
 * Responsibilities:
 * - Process incoming messages with NLU
 * - Generate contextual responses
 * - Collect required contact information
 * - Coordinate scheduling and follow-ups
 *
 * Tools:
 * - contact_lookup: Check contact information
 * - contact_update: Save collected information
 * - calendly_link: Get scheduling link
 */
export class ConversationAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for conversation
   */
  protected getSystemPrompt(context: AgentContext): string {
    const basePrompt = buildSystemPrompt(context.config);

    // Add contact context if available
    const requiredFields = context.config.requiredFields ?? [
      "email",
      "company_name",
      "job_title",
    ];
    const contactContext = buildContactContext(context.contact ?? null, requiredFields);

    return `${basePrompt}

${contactContext}

## Current Conversation
Phone: ${context.phoneNumber || "Unknown"}
Channel: ${context.channel || "whatsapp"}

Respond naturally and helpfully. Use tools when needed to look up or update contact information.

## Personalized Video
If the contact asks for their video, wants to see the video, or you want to share their personalized video:
1. Use the send_video tool with their phone number
2. The video will be retrieved from the database and sent to them
3. Let them know the video is on its way

## Data Deletion Requests
If someone asks to have their data deleted, removed, or forgotten (GDPR request):
1. Acknowledge their request
2. Use the delete_contact tool with their phone number and confirmDeletion=true
3. Confirm the deletion was successful
4. Let them know their data has been removed from our system`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "contact_lookup",
        "Look up a contact in the database by phone number or email. Returns contact details and any missing required fields.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number to look up (E.164 format preferred)",
          },
          email: {
            type: "string",
            description: "Email address to look up",
          },
        }
      ),
      defineTool(
        "contact_update",
        "Update contact information. Use this to save information the user provides (email, company, job title, etc.).",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact (E.164 format)",
          },
          updates: {
            type: "object",
            description: "Fields to update",
            properties: {
              email: { type: "string", description: "Email address" },
              first_name: { type: "string", description: "First name" },
              last_name: { type: "string", description: "Last name" },
              company_name: { type: "string", description: "Company name" },
              job_title: { type: "string", description: "Job title / role" },
              industry: { type: "string", description: "Industry sector" },
              linkedin_url: { type: "string", description: "LinkedIn profile URL" },
            },
          },
        },
        ["phoneNumber", "updates"]
      ),
      defineTool(
        "calendly_link",
        "Get the Calendly scheduling link to share with the contact.",
        {},
        []
      ),
      defineTool(
        "delete_contact",
        "Delete a contact's data from the database. Use this when someone explicitly requests their data be deleted (GDPR/privacy request). Confirm with the user before deleting.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact to delete",
          },
          confirmDeletion: {
            type: "boolean",
            description: "Must be true to confirm deletion",
          },
        },
        ["phoneNumber", "confirmDeletion"]
      ),
      defineTool(
        "send_video",
        "Send the personalized HeyGen video to the contact. Retrieves the video from the database and queues it for delivery. Use this when the contact asks for their video, wants to see the video, or when you want to share their personalized video.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact to send video to",
          },
        },
        ["phoneNumber"]
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // Contact lookup
    this.toolExecutor.registerTool(
      defineTool(
        "contact_lookup",
        "Look up contact",
        {
          phoneNumber: { type: "string" },
          email: { type: "string" },
        }
      ),
      async (input, context) => {
        const result = await contactLookup(
          {
            phoneNumber: input.phoneNumber as string | undefined,
            email: input.email as string | undefined,
          },
          context.config.supabase,
          context.config.requiredFields
        );
        return result;
      }
    );

    // Contact update
    this.toolExecutor.registerTool(
      defineTool(
        "contact_update",
        "Update contact",
        {
          phoneNumber: { type: "string" },
          updates: { type: "object" },
        },
        ["phoneNumber", "updates"]
      ),
      async (input, context) => {
        const result = await contactUpdate(
          {
            phoneNumber: input.phoneNumber as string,
            updates: input.updates as Record<string, string>,
          },
          context.config.supabase,
          context.config.requiredFields
        );
        return result;
      }
    );

    // Calendly link
    this.toolExecutor.registerTool(
      defineTool("calendly_link", "Get scheduling link", {}),
      async (_, context) => {
        const calendlyLink = context.config.calendly?.schedulingLink;
        if (!calendlyLink) {
          return { link: null, error: "Calendly not configured" };
        }
        return { link: calendlyLink };
      }
    );

    // Delete contact (GDPR compliance)
    this.toolExecutor.registerTool(
      defineTool(
        "delete_contact",
        "Delete contact data",
        {
          phoneNumber: { type: "string" },
          confirmDeletion: { type: "boolean" },
        },
        ["phoneNumber", "confirmDeletion"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const confirmDeletion = input.confirmDeletion as boolean;

        if (!confirmDeletion) {
          return {
            success: false,
            error: "Deletion not confirmed. Set confirmDeletion to true to proceed.",
          };
        }

        const result = await deleteContactByPhone(phoneNumber, context.config.supabase);

        if (result.success) {
          context.logger.info({ phoneNumber }, "Contact data deleted per user request");
        }

        return result;
      }
    );

    // Send video to contact
    this.toolExecutor.registerTool(
      defineTool(
        "send_video",
        "Send personalized video",
        {
          phoneNumber: { type: "string" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;

        // Look up the contact to get video info
        const contact = await findContactByPhone(phoneNumber, context.config.supabase);

        if (!contact) {
          return {
            success: false,
            error: "Contact not found",
          };
        }

        if (!contact.heygen_video_url) {
          return {
            success: false,
            error: "No video available for this contact. Video may still be generating.",
            hasVideoId: !!contact.heygen_video_id,
          };
        }

        // Queue the video for sending
        const firstName = contact.first_name || "there";
        const outboundJob: OutboundMessageJob = {
          correlationId: createCorrelationId(),
          phoneNumber,
          channel: context.channel || "whatsapp",
          messageType: "video",
          content: contact.heygen_video_url,
          caption: `Hey ${firstName}, Wanna grab a coffee sometime to discuss more about making your life easier with AI?`,
          metadata: { videoId: contact.heygen_video_id },
        };

        await addJob("outbound-messages", outboundJob);

        context.logger.info(
          { phoneNumber, videoId: contact.heygen_video_id },
          "Video queued for sending"
        );

        return {
          success: true,
          message: "Video queued for delivery",
          videoId: contact.heygen_video_id,
        };
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(
    response: string,
    toolCalls?: ToolCall[]
  ): AgentType | undefined {
    // Check if research is needed
    if (toolCalls?.some((tc) => tc.name === "linkedin_research")) {
      return "research";
    }

    // Check if CRM sync is needed
    if (toolCalls?.some((tc) => tc.name === "crm_sync")) {
      return "crm";
    }

    // Check if video generation is needed
    if (toolCalls?.some((tc) => tc.name === "heygen_video")) {
      return "video";
    }

    return undefined;
  }

  /**
   * Check if all required fields have been collected
   */
  private async checkFieldsComplete(
    phoneNumber: string,
    context: AgentContext
  ): Promise<{ complete: boolean; missing: string[] }> {
    const contact = await findContactByPhone(phoneNumber, context.config.supabase);

    if (!contact) {
      const requiredFields = context.config.requiredFields ?? [
        "email",
        "company_name",
        "job_title",
      ];
      return { complete: false, missing: requiredFields };
    }

    const missing = getMissingRequiredFields(
      contact,
      context.config.requiredFields ?? ["email", "company_name", "job_title"]
    );

    return {
      complete: missing.length === 0,
      missing,
    };
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "handle_message",
      "continue_conversation",
      "collect_info",
      "answer_question",
      "schedule_meeting",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("conversation", () => new ConversationAgent());

export default ConversationAgent;
