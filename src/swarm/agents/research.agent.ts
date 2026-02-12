import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { linkedinResearch } from "../../agent/tools/linkedin-research.js";
import { updateContactByPhone } from "../../contacts/supabase-repo.js";

/**
 * Research Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "research",
  name: "Research Agent",
  description:
    "Performs LinkedIn and company research to enrich contact data and provide background information.",
  temperature: 0.3, // Lower temperature for more factual responses
};

/**
 * ResearchAgent - Handles LinkedIn and company research
 *
 * Responsibilities:
 * - Look up LinkedIn profiles by URL, email, or name
 * - Research companies
 * - Enrich contact records with found data
 * - Update research status in database
 *
 * Tools:
 * - linkedin_research: Look up LinkedIn profiles
 * - company_research: Research company information
 * - update_research_status: Mark research as complete/failed
 */
export class ResearchAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for research
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the host";

    return `You are a research agent for ${ownerName}'s networking follow-up system.

## Your Role
You research contacts to gather professional background information that helps personalize follow-up communications.

## Research Tasks
1. **LinkedIn Research**: Look up profiles to find:
   - Current job title and company
   - Professional headline
   - Industry and experience
   - Location

2. **Company Research**: When available, gather:
   - Company size and industry
   - What they do
   - Recent news or developments

## Guidelines
- Always start with the most specific information available (LinkedIn URL > email > name)
- If you have partial information, use it to narrow your search
- Update the contact record with any new information found
- Be respectful of rate limits - don't make unnecessary API calls
- Report back what you found and what couldn't be found

## Current Task
${context.contact ? `Researching contact: ${context.contact.first_name || "Unknown"} (${context.phoneNumber})` : "New research request"}

Available info:
${context.contact?.linkedin_url ? `- LinkedIn: ${context.contact.linkedin_url}` : ""}
${context.contact?.email ? `- Email: ${context.contact.email}` : ""}
${context.contact?.first_name ? `- First Name: ${context.contact.first_name}` : ""}
${context.contact?.last_name ? `- Last Name: ${context.contact.last_name}` : ""}
${context.contact?.company_name ? `- Company: ${context.contact.company_name}` : ""}

Use the tools available to research this contact and update their record.`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "linkedin_research",
        "Research a contact on LinkedIn. Can search by LinkedIn URL, email, or name + company. Updates contact record with found information.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact (for saving data)",
          },
          email: {
            type: "string",
            description: "Email to search LinkedIn by",
          },
          linkedinUrl: {
            type: "string",
            description: "Direct LinkedIn profile URL if known",
          },
          firstName: {
            type: "string",
            description: "First name to help with search",
          },
          lastName: {
            type: "string",
            description: "Last name to help with search",
          },
          companyName: {
            type: "string",
            description: "Company name to help narrow search",
          },
        }
      ),
      defineTool(
        "update_research_status",
        "Update the research status for a contact (pending, in_progress, complete, failed)",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "complete", "failed"],
            description: "Research status",
          },
          researchData: {
            type: "object",
            description: "Research data to store (optional)",
          },
        },
        ["phoneNumber", "status"]
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // LinkedIn research
    this.toolExecutor.registerTool(
      defineTool(
        "linkedin_research",
        "Research LinkedIn",
        {
          phoneNumber: { type: "string" },
          email: { type: "string" },
          linkedinUrl: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          companyName: { type: "string" },
        }
      ),
      async (input, context) => {
        const result = await linkedinResearch(
          {
            phoneNumber: input.phoneNumber as string | undefined,
            email: input.email as string | undefined,
            linkedinUrl: input.linkedinUrl as string | undefined,
            firstName: input.firstName as string | undefined,
            lastName: input.lastName as string | undefined,
            companyName: input.companyName as string | undefined,
          },
          context.config.linkedin,
          context.config.supabase
        );
        return result;
      }
    );

    // Update research status
    this.toolExecutor.registerTool(
      defineTool(
        "update_research_status",
        "Update research status",
        {
          phoneNumber: { type: "string" },
          status: { type: "string" },
          researchData: { type: "object" },
        },
        ["phoneNumber", "status"]
      ),
      async (input, context) => {
        try {
          await updateContactByPhone(
            input.phoneNumber as string,
            {
              research_status: input.status as string,
              research_data: input.researchData
                ? JSON.stringify(input.researchData)
                : undefined,
            },
            context.config.supabase
          );
          return { success: true, status: input.status };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // After research, typically hand off to qualification
    return "qualification";
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "linkedin_research",
      "company_research",
      "enrich_contact",
      "background_check",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("research", () => new ResearchAgent());

export default ResearchAgent;
