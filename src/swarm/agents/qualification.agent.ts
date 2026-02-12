import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType, QualificationTier } from "../types.js";
import { updateContactByPhone } from "../../contacts/supabase-repo.js";
import type { NetworkingContact } from "../../config/types.js";

/**
 * Qualification Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "qualification",
  name: "Qualification Agent",
  description:
    "Evaluates leads and assigns qualification scores and tiers based on profile data and engagement.",
  temperature: 0.2, // Low temperature for consistent scoring
};

/**
 * Scoring factors for lead qualification
 */
interface QualificationFactors {
  profileCompleteness: number; // 0-25 points
  engagement: number; // 0-25 points
  fit: number; // 0-25 points
  timing: number; // 0-25 points
}

/**
 * QualificationAgent - Scores and categorizes leads
 *
 * Responsibilities:
 * - Evaluate contact data for lead quality
 * - Calculate qualification scores (0-100)
 * - Assign qualification tiers (hot/warm/cold/unqualified)
 * - Consider engagement signals and timing
 *
 * Scoring Methodology:
 * - Profile Completeness (25 pts): Email, company, title, LinkedIn
 * - Engagement (25 pts): Response time, message count, questions asked
 * - Fit (25 pts): Industry, role seniority, company size
 * - Timing (25 pts): Meeting scheduled, recent activity
 */
export class QualificationAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for qualification
   */
  protected getSystemPrompt(context: AgentContext): string {
    const ownerName = context.config.ownerName ?? "the host";

    return `You are a lead qualification agent for ${ownerName}'s networking system.

## Your Role
Evaluate contacts to determine lead quality and prioritization.

## Scoring Methodology (0-100 total)

### 1. Profile Completeness (0-25 points)
- Has email: +5
- Has company name: +5
- Has job title: +5
- Has LinkedIn: +5
- Has full name: +5

### 2. Engagement Level (0-25 points)
- Responded within 24 hours: +10
- Multiple conversation turns: +5
- Asked questions: +5
- Shared additional info voluntarily: +5

### 3. Fit Assessment (0-25 points)
- Decision maker role (VP, Director, C-level): +10
- Target industry: +10
- Growing company indicators: +5

### 4. Timing Signals (0-25 points)
- Meeting scheduled: +15
- Active in last 48 hours: +5
- Expressed interest in specific offering: +5

## Tier Assignment
- **Hot** (75-100): High priority, immediate follow-up
- **Warm** (50-74): Good potential, regular nurture
- **Cold** (25-49): Low engagement, long-term nurture
- **Unqualified** (0-24): Not a fit, minimal attention

## Current Contact
${this.formatContactData(context.contact)}

Analyze this contact and provide a qualification assessment.`;
  }

  /**
   * Format contact data for the prompt
   */
  private formatContactData(contact?: NetworkingContact | null): string {
    if (!contact) {
      return "No contact data available.";
    }

    const lines: string[] = [];
    if (contact.first_name) lines.push(`Name: ${contact.first_name} ${contact.last_name || ""}`);
    if (contact.email) lines.push(`Email: ${contact.email}`);
    if (contact.company_name) lines.push(`Company: ${contact.company_name}`);
    if (contact.job_title) lines.push(`Title: ${contact.job_title}`);
    if (contact.industry) lines.push(`Industry: ${contact.industry}`);
    if (contact.linkedin_url) lines.push(`LinkedIn: ${contact.linkedin_url}`);
    if (contact.calendly_scheduled_at) {
      lines.push(`Meeting Scheduled: ${new Date(contact.calendly_scheduled_at).toLocaleString()}`);
    }
    if (contact.status) lines.push(`Status: ${contact.status}`);
    if (contact.created_at) {
      lines.push(`First Contact: ${new Date(contact.created_at).toLocaleString()}`);
    }
    if (contact.updated_at) {
      lines.push(`Last Activity: ${new Date(contact.updated_at).toLocaleString()}`);
    }

    return lines.join("\n");
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "set_qualification",
        "Set the qualification score and tier for a contact",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact",
          },
          score: {
            type: "number",
            description: "Qualification score (0-100)",
            minimum: 0,
            maximum: 100,
          },
          tier: {
            type: "string",
            enum: ["hot", "warm", "cold", "unqualified"],
            description: "Qualification tier",
          },
          factors: {
            type: "object",
            description: "Breakdown of scoring factors",
            properties: {
              profileCompleteness: { type: "number" },
              engagement: { type: "number" },
              fit: { type: "number" },
              timing: { type: "number" },
            },
          },
          notes: {
            type: "string",
            description: "Optional notes about the qualification",
          },
        },
        ["phoneNumber", "score", "tier"]
      ),
      defineTool(
        "get_engagement_data",
        "Get engagement metrics for a contact",
        {
          phoneNumber: {
            type: "string",
            description: "Phone number of the contact",
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
    // Set qualification
    this.toolExecutor.registerTool(
      defineTool(
        "set_qualification",
        "Set qualification",
        {
          phoneNumber: { type: "string" },
          score: { type: "number" },
          tier: { type: "string" },
          factors: { type: "object" },
          notes: { type: "string" },
        },
        ["phoneNumber", "score", "tier"]
      ),
      async (input, context) => {
        try {
          const score = Math.min(100, Math.max(0, input.score as number));
          const tier = input.tier as QualificationTier;

          await updateContactByPhone(
            input.phoneNumber as string,
            {
              qualification_score: score,
              qualification_tier: tier,
              swarm_metadata: JSON.stringify({
                qualificationFactors: input.factors,
                qualificationNotes: input.notes,
                qualifiedAt: new Date().toISOString(),
              }),
            },
            context.config.supabase
          );

          return {
            success: true,
            score,
            tier,
            message: `Contact qualified as ${tier} with score ${score}`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Get engagement data
    this.toolExecutor.registerTool(
      defineTool(
        "get_engagement_data",
        "Get engagement metrics",
        { phoneNumber: { type: "string" } },
        ["phoneNumber"]
      ),
      async (input, context) => {
        // This would typically query message_history for engagement metrics
        // For now, return placeholder data
        return {
          totalMessages: context.contact?.total_turns || 0,
          lastActivity: context.contact?.updated_at,
          meetingScheduled: !!context.contact?.calendly_scheduled_at,
          crmSynced: !!context.contact?.crm_synced_at,
        };
      }
    );
  }

  /**
   * Calculate qualification score based on contact data
   */
  calculateScore(contact: NetworkingContact): {
    score: number;
    tier: QualificationTier;
    factors: QualificationFactors;
  } {
    const factors: QualificationFactors = {
      profileCompleteness: 0,
      engagement: 0,
      fit: 0,
      timing: 0,
    };

    // Profile Completeness (0-25)
    if (contact.email) factors.profileCompleteness += 5;
    if (contact.company_name) factors.profileCompleteness += 5;
    if (contact.job_title) factors.profileCompleteness += 5;
    if (contact.linkedin_url) factors.profileCompleteness += 5;
    if (contact.first_name && contact.last_name) factors.profileCompleteness += 5;

    // Engagement (0-25) - simplified
    if (contact.total_turns && contact.total_turns > 2) factors.engagement += 10;
    if (contact.total_turns && contact.total_turns > 5) factors.engagement += 5;
    if (contact.sent_personalized_message) factors.engagement += 5;
    // Would need message history for more detailed engagement scoring

    // Fit (0-25) - based on title keywords
    const title = contact.job_title?.toLowerCase() || "";
    if (/\b(ceo|cto|cfo|coo|chief|founder|owner)\b/.test(title)) {
      factors.fit += 10;
    } else if (/\b(vp|vice president|director|head of)\b/.test(title)) {
      factors.fit += 7;
    } else if (/\b(manager|lead|senior)\b/.test(title)) {
      factors.fit += 5;
    }
    if (contact.industry) factors.fit += 5;
    if (contact.company_name) factors.fit += 5;

    // Timing (0-25)
    if (contact.calendly_scheduled_at) factors.timing += 15;
    if (contact.updated_at) {
      const hoursSinceUpdate =
        (Date.now() - new Date(contact.updated_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 48) factors.timing += 5;
    }
    if (contact.status === "fields_complete" || contact.status === "synced") {
      factors.timing += 5;
    }

    // Calculate total score
    const score =
      factors.profileCompleteness + factors.engagement + factors.fit + factors.timing;

    // Determine tier
    let tier: QualificationTier;
    if (score >= 75) {
      tier = "hot";
    } else if (score >= 50) {
      tier = "warm";
    } else if (score >= 25) {
      tier = "cold";
    } else {
      tier = "unqualified";
    }

    return { score, tier, factors };
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // After qualification, hand off to CRM for syncing
    return "crm";
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "qualify_lead",
      "score_contact",
      "update_qualification",
      "batch_qualify",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("qualification", () => new QualificationAgent());

export default QualificationAgent;
