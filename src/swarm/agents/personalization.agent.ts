import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import type { NetworkingContact } from "../../config/types.js";

/**
 * Personalization Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "personalization",
  name: "Personalization Agent",
  description:
    "Generates personalized content like welcome messages, email templates, and video scripts.",
  temperature: 0.8, // Higher temperature for creative content
};

/**
 * PersonalizationAgent - Generates personalized content
 *
 * Responsibilities:
 * - Generate personalized welcome messages
 * - Create custom email templates
 * - Write video scripts for HeyGen
 * - Adapt messaging based on contact profile
 *
 * Tools:
 * - generate_welcome_message: Create personalized welcome
 * - generate_email: Create follow-up email
 * - generate_video_script: Create HeyGen video script
 */
export class PersonalizationAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for personalization
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the host";
    const eventName = context.config.eventName ?? "the event";

    return `You are a personalization specialist for ${ownerName}'s networking follow-up system.

## Your Role
Create personalized, engaging content that helps build genuine connections with networking contacts.

## Personalization Principles

### 1. Use Available Information
- Reference their name, company, and role naturally
- Mention the event where you met if known
- Acknowledge their industry or field

### 2. Match Their Level
- Adjust formality based on their title and industry
- Use appropriate technical language if relevant
- Keep it professional but warm

### 3. Be Genuine
- Avoid generic, template-y language
- Sound like a real person wrote it
- Express authentic interest

### 4. Be Concise
- Welcome messages: 2-3 sentences max
- Emails: 3-4 short paragraphs
- Video scripts: 30-60 seconds when spoken

## Brand Voice for ${ownerName}
- Professional but approachable
- Knowledgeable but not arrogant
- Helpful and value-focused
- ${eventName ? `References ${eventName} when relevant` : ""}

## Current Contact
${this.formatContactProfile(context.contact)}

Generate content that feels personal and genuine, not templated.`;
  }

  /**
   * Format contact profile for the prompt
   */
  private formatContactProfile(contact?: NetworkingContact | null): string {
    if (!contact) {
      return "No contact information available - generate generic but warm content.";
    }

    const lines: string[] = [];
    if (contact.first_name) {
      lines.push(`Name: ${contact.first_name} ${contact.last_name || ""}`);
    }
    if (contact.company_name) lines.push(`Company: ${contact.company_name}`);
    if (contact.job_title) lines.push(`Role: ${contact.job_title}`);
    if (contact.industry) lines.push(`Industry: ${contact.industry}`);
    if (contact.event_name) lines.push(`Met at: ${contact.event_name}`);

    // Research data if available
    if (contact.research_data) {
      const data = contact.research_data as Record<string, unknown>;
      if (data.linkedinProfile) {
        const profile = data.linkedinProfile as Record<string, unknown>;
        if (profile.headline) lines.push(`Headline: ${profile.headline}`);
      }
    }

    return lines.length > 0 ? lines.join("\n") : "Basic contact info only.";
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "generate_welcome_message",
        "Generate a personalized welcome message for WhatsApp/text",
        {
          firstName: {
            type: "string",
            description: "Contact's first name",
          },
          eventName: {
            type: "string",
            description: "Event where we met",
          },
          includeCalendlyLink: {
            type: "boolean",
            description: "Whether to include scheduling link",
          },
          tone: {
            type: "string",
            enum: ["formal", "casual", "friendly"],
            description: "Message tone",
          },
        }
      ),
      defineTool(
        "generate_email",
        "Generate a personalized follow-up email",
        {
          firstName: {
            type: "string",
            description: "Contact's first name",
          },
          company: {
            type: "string",
            description: "Contact's company",
          },
          purpose: {
            type: "string",
            enum: ["introduction", "follow-up", "value-add", "meeting-request"],
            description: "Email purpose",
          },
          keyPoints: {
            type: "array",
            description: "Key points to include",
            items: { type: "string" },
          },
        }
      ),
      defineTool(
        "generate_video_script",
        "Generate a personalized video script for HeyGen",
        {
          firstName: {
            type: "string",
            description: "Contact's first name",
          },
          eventName: {
            type: "string",
            description: "Event where we met",
          },
          maxDurationSeconds: {
            type: "number",
            description: "Maximum video duration in seconds",
          },
          callToAction: {
            type: "string",
            description: "Desired call to action",
          },
        }
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // Generate welcome message
    this.toolExecutor.registerTool(
      defineTool(
        "generate_welcome_message",
        "Generate welcome",
        {
          firstName: { type: "string" },
          eventName: { type: "string" },
          includeCalendlyLink: { type: "boolean" },
          tone: { type: "string" },
        }
      ),
      async (input, context) => {
        const firstName = (input.firstName as string) || "there";
        const eventName = (input.eventName as string) || context.config.eventName || "the event";
        const ownerName = context.config.ownerName || "I";
        const calendlyLink = context.config.calendly?.schedulingLink;
        const includeLink = input.includeCalendlyLink && calendlyLink;

        // Generate using LLM
        const prompt = `Generate a warm, personalized welcome message for ${firstName} who ${ownerName} met at ${eventName}. Keep it to 2-3 sentences. ${includeLink ? `End with: "Book time to chat: ${calendlyLink}"` : ""} Tone: ${input.tone || "friendly"}`;

        const response = await this.llmClient.chat(
          this.getSystemPrompt(context),
          prompt,
          { temperature: 0.8 }
        );

        return { message: response };
      }
    );

    // Generate email
    this.toolExecutor.registerTool(
      defineTool(
        "generate_email",
        "Generate email",
        {
          firstName: { type: "string" },
          company: { type: "string" },
          purpose: { type: "string" },
          keyPoints: { type: "array" },
        }
      ),
      async (input, context) => {
        const firstName = (input.firstName as string) || "there";
        const company = input.company as string;
        const purpose = (input.purpose as string) || "follow-up";
        const keyPoints = (input.keyPoints as string[]) || [];

        const prompt = `Generate a ${purpose} email for ${firstName}${company ? ` at ${company}` : ""}.
Key points to include: ${keyPoints.length > 0 ? keyPoints.join(", ") : "general follow-up"}
Keep it concise (3-4 short paragraphs). Include subject line.`;

        const response = await this.llmClient.chat(
          this.getSystemPrompt(context),
          prompt,
          { temperature: 0.7 }
        );

        return { email: response };
      }
    );

    // Generate video script
    this.toolExecutor.registerTool(
      defineTool(
        "generate_video_script",
        "Generate video script",
        {
          firstName: { type: "string" },
          eventName: { type: "string" },
          maxDurationSeconds: { type: "number" },
          callToAction: { type: "string" },
        }
      ),
      async (input, context) => {
        const firstName = (input.firstName as string) || "there";
        const eventName = (input.eventName as string) || context.config.eventName;
        const maxSeconds = (input.maxDurationSeconds as number) || 45;
        const cta = (input.callToAction as string) || "book a call";

        // Estimate ~150 words per minute for speaking
        const maxWords = Math.floor((maxSeconds / 60) * 150);

        const prompt = `Generate a personalized video script for ${firstName}${eventName ? ` who we met at ${eventName}` : ""}.
Maximum ${maxWords} words (${maxSeconds} seconds when spoken).
End with call to action: ${cta}
Write as if speaking directly to them on video. Be warm and personal.`;

        const response = await this.llmClient.chat(
          this.getSystemPrompt(context),
          prompt,
          { temperature: 0.8 }
        );

        return {
          script: response,
          estimatedDurationSeconds: Math.ceil(response.split(/\s+/).length / 150 * 60),
        };
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // After personalization, may hand off to video agent
    return undefined;
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "generate_welcome",
      "generate_email",
      "generate_video_script",
      "personalize_content",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("personalization", () => new PersonalizationAgent());

export default PersonalizationAgent;
