import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, ToolCall, AgentType } from "../types.js";
import { buildSystemPrompt, buildContactContext } from "../../agent/prompts.js";
import { contactLookup } from "../../agent/tools/contact-lookup.js";
import { contactUpdate } from "../../agent/tools/contact-update.js";
import { findContactByPhone } from "../../contacts/supabase-repo.js";
import { getMissingRequiredFields } from "../../contacts/state-machine.js";

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

Respond naturally and helpfully. Use tools when needed to look up or update contact information.`;
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
