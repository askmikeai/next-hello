import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { updateContactByPhone } from "../../contacts/index.js";
import { enrichContactQueued, type PDLEnrichmentResult } from "../../integrations/pdl/index.js";

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
 * - Enrich contacts using People Data Labs API
 * - Research companies
 * - Enrich contact records with found data
 * - Update research status in database
 *
 * Tools:
 * - pdl_enrich: Enrich contact using People Data Labs (primary method)
 * - linkedin_research: Look up LinkedIn profiles (fallback)
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

## Research Tool: PDL Enrichment
Use the \`pdl_enrich\` tool to look up contacts. People Data Labs has a database of 3+ billion profiles and provides:
- Verified work email addresses
- Current job title and company
- Work history and education
- LinkedIn profile URL
- Company details (size, industry, revenue)
- Inferred salary range
- Skills and certifications

PDL can lookup by: email, phone number, LinkedIn URL, or name + company.

## Guidelines
- Pass the phoneNumber parameter to save enriched data automatically
- If PDL returns a match, the contact record will be updated automatically
- Report what data was found and the confidence level (likelihood score)
- If no match is found, update the research status to "failed"

## Current Task
${context.contact ? `Researching contact: ${context.contact.first_name || "Unknown"} (${context.phoneNumber})` : "New research request"}

Available info for lookup:
${context.contact?.linkedin_url ? `- LinkedIn: ${context.contact.linkedin_url}` : ""}
${context.contact?.email ? `- Email: ${context.contact.email}` : ""}
${context.contact?.first_name ? `- First Name: ${context.contact.first_name}` : ""}
${context.contact?.last_name ? `- Last Name: ${context.contact.last_name}` : ""}
${context.contact?.company_name ? `- Company: ${context.contact.company_name}` : ""}

Call pdl_enrich with the available information.`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "pdl_enrich",
        "Enrich a contact using People Data Labs API. Can lookup by email, phone, LinkedIn URL, or name + company. Returns comprehensive professional data including work history, education, skills, and verified contact info.",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact (for saving enriched data)",
          },
          email: {
            type: "string",
            description: "Email address to lookup",
          },
          linkedinUrl: {
            type: "string",
            description: "LinkedIn profile URL",
          },
          firstName: {
            type: "string",
            description: "First name (use with lastName + company)",
          },
          lastName: {
            type: "string",
            description: "Last name (use with firstName + company)",
          },
          company: {
            type: "string",
            description: "Company name (helps narrow search when using name)",
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
    // PDL Enrichment (primary method)
    this.toolExecutor.registerTool(
      defineTool(
        "pdl_enrich",
        "Enrich contact using People Data Labs",
        {
          phoneNumber: { type: "string" },
          email: { type: "string" },
          linkedinUrl: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          company: { type: "string" },
        }
      ),
      async (input, context) => {
        const result: PDLEnrichmentResult = await enrichContactQueued({
          email: input.email as string | undefined,
          phone: input.phoneNumber as string | undefined,
          linkedinUrl: input.linkedinUrl as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          company: input.company as string | undefined,
        }, { correlationId: context.correlationId });

        if (result.success && result.data && input.phoneNumber) {
          // Update contact with enriched data
          try {
            const enrichedData: Record<string, unknown> = {};

            if (result.data.job_title) enrichedData.job_title = result.data.job_title;
            if (result.data.job_company_name) enrichedData.company_name = result.data.job_company_name;
            if (result.data.linkedin_url) enrichedData.linkedin_url = result.data.linkedin_url;
            if (result.data.work_email) enrichedData.email = result.data.work_email;
            if (result.data.first_name) enrichedData.first_name = result.data.first_name;
            if (result.data.last_name) enrichedData.last_name = result.data.last_name;
            if (result.data.location_locality) enrichedData.location = result.data.location_name;
            if (result.data.job_company_industry) enrichedData.industry = result.data.job_company_industry;

            await updateContactByPhone(
              input.phoneNumber as string,
              enrichedData,
              context.config.supabase
            );

            context.logger.info({
              msg: "Contact enriched via PDL",
              phoneNumber: input.phoneNumber,
              likelihood: result.likelihood,
              matchedOn: result.matched_on,
            });
          } catch (error) {
            context.logger.error({
              msg: "Failed to update contact with PDL data",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          success: result.success,
          likelihood: result.likelihood,
          matchedOn: result.matched_on,
          data: result.data ? {
            fullName: result.data.full_name,
            jobTitle: result.data.job_title,
            company: result.data.job_company_name,
            companyIndustry: result.data.job_company_industry,
            companySize: result.data.job_company_size,
            linkedinUrl: result.data.linkedin_url,
            workEmail: result.data.work_email,
            location: result.data.location_name,
            inferredSalary: result.data.inferred_salary,
            yearsExperience: result.data.inferred_years_experience,
            skills: result.data.skills,
            educationCount: result.data.education?.length ?? 0,
            experienceCount: result.data.experience?.length ?? 0,
          } : undefined,
          error: result.error,
        };
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
              research_status: input.status as "pending" | "in_progress" | "complete" | "failed",
              research_data: input.researchData as Record<string, unknown> | undefined,
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
      "pdl_enrich",
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
