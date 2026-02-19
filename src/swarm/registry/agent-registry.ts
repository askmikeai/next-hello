/**
 * Agent Registry - Describes agent capabilities for Claude's reasoning
 *
 * This registry provides Claude with the information it needs to make
 * intelligent decisions about which agents to invoke and in what order.
 */

import type { AgentType } from "../types.js";

/**
 * Duration categories for agent execution
 */
export type AgentDuration = "instant" | "fast" | "medium" | "slow" | "very_slow";

/**
 * Agent capability description for Claude's reasoning
 */
export interface AgentCapability {
  /** Human-readable agent name */
  name: string;
  /** What this agent does */
  description: string;
  /** Specific capabilities/actions this agent can perform */
  capabilities: string[];
  /** Input data this agent can work with */
  inputs: string[];
  /** Data this agent produces */
  outputs: string[];
  /** Typical execution duration */
  typicalDuration: AgentDuration;
  /** Can this agent run in the background (fire-and-forget)? */
  canRunInBackground: boolean;
  /** Agent types this one depends on (must complete first) */
  dependsOn?: AgentType[];
  /** When to use this agent */
  whenToUse: string;
  /** When NOT to use this agent */
  whenNotToUse?: string;
}

/**
 * Agent capabilities registry - Claude uses this to reason about agent selection
 */
export const AGENT_CAPABILITIES: Record<AgentType, AgentCapability> = {
  orchestrator: {
    name: "Orchestrator",
    description: "Central coordinator that manages conversations and delegates to other agents",
    capabilities: [
      "Direct conversation handling",
      "Agent coordination",
      "Strategy decisions",
    ],
    inputs: ["user messages", "conversation history"],
    outputs: ["responses", "agent invocations"],
    typicalDuration: "fast",
    canRunInBackground: false,
    whenToUse: "Always active - this is you!",
  },

  research: {
    name: "Research Agent",
    description: "Enriches contact data using People Data Labs API. Finds professional background, work history, education, skills, and verified contact information.",
    capabilities: [
      "LinkedIn profile lookup",
      "Email verification and discovery",
      "Company information retrieval",
      "Professional background research",
      "Skills and experience analysis",
    ],
    inputs: [
      "email address",
      "LinkedIn URL",
      "firstName + lastName + company",
      "phone number",
    ],
    outputs: [
      "jobTitle",
      "companyName",
      "companyIndustry",
      "companySize",
      "linkedinUrl",
      "workEmail",
      "location",
      "skills",
      "yearsExperience",
      "education",
      "workHistory",
    ],
    typicalDuration: "slow",
    canRunInBackground: true,
    whenToUse: "When you need professional background on a contact, when they share their LinkedIn or email, or when you want to personalize follow-up.",
    whenNotToUse: "If contact already has rich research_data, or if they haven't shared identifying info yet.",
  },

  qualification: {
    name: "Qualification Agent",
    description: "Scores leads and assigns qualification tiers based on research data and conversation signals.",
    capabilities: [
      "Lead scoring (0-100)",
      "Tier assignment (hot/warm/cold/unqualified)",
      "Qualification factor analysis",
      "Priority assessment",
    ],
    inputs: [
      "contactData",
      "researchData (from research agent)",
      "conversationSignals",
    ],
    outputs: [
      "qualificationScore",
      "qualificationTier",
      "qualificationFactors",
      "priorityLevel",
    ],
    typicalDuration: "fast",
    canRunInBackground: false,
    dependsOn: ["research"],
    whenToUse: "After research completes, to determine lead quality and prioritize follow-up.",
    whenNotToUse: "Before research data is available - qualification needs enriched data to score accurately.",
  },

  personalization: {
    name: "Personalization Agent",
    description: "Generates personalized content like video scripts, email drafts, and follow-up messages based on contact data.",
    capabilities: [
      "Video script generation",
      "Email draft creation",
      "Personalized message crafting",
      "Follow-up content planning",
    ],
    inputs: [
      "contactData",
      "researchData",
      "qualificationData",
      "templates",
    ],
    outputs: [
      "videoScript",
      "emailDraft",
      "personalizedMessage",
      "followUpPlan",
    ],
    typicalDuration: "medium",
    canRunInBackground: false,
    dependsOn: ["research"],
    whenToUse: "When generating personalized content for high-quality leads.",
    whenNotToUse: "For cold leads or when basic templates suffice.",
  },

  video: {
    name: "Video Agent",
    description: "Generates personalized HeyGen videos with AI avatar speaking custom scripts.",
    capabilities: [
      "HeyGen video generation",
      "Personalized video scripts",
      "Video status tracking",
      "Video delivery",
    ],
    inputs: [
      "firstName",
      "scriptTemplate or customScript",
      "variables for personalization",
    ],
    outputs: [
      "videoId",
      "videoUrl",
      "videoStatus",
      "estimatedCompletionTime",
    ],
    typicalDuration: "very_slow",
    canRunInBackground: true,
    whenToUse: "For promising leads who have shared their info, to create memorable personalized follow-up.",
    whenNotToUse: "For cold leads, or if video already exists for this contact.",
  },

  voice: {
    name: "Voice Agent",
    description: "Generates voice messages using ElevenLabs text-to-speech.",
    capabilities: [
      "Voice message generation",
      "Text-to-speech conversion",
      "Voice message delivery",
    ],
    inputs: [
      "text to speak",
      "firstName for personalization",
    ],
    outputs: [
      "audioData",
      "voiceMessageUrl",
      "durationSeconds",
    ],
    typicalDuration: "medium",
    canRunInBackground: true,
    whenToUse: "When the user prefers voice communication, or for a more personal touch.",
    whenNotToUse: "When user prefers text, or for quick informational responses.",
  },

  crm: {
    name: "CRM Agent",
    description: "Synchronizes contact data with HubSpot CRM.",
    capabilities: [
      "HubSpot contact creation",
      "HubSpot contact updates",
      "CRM field mapping",
      "Sync status tracking",
    ],
    inputs: [
      "contactData",
      "propertyMappings",
    ],
    outputs: [
      "crmContactId",
      "syncStatus",
      "syncedAt",
    ],
    typicalDuration: "fast",
    canRunInBackground: true,
    whenToUse: "After collecting contact info to keep CRM in sync, or after qualification to update lead status.",
    whenNotToUse: "If CRM is not configured, or if no new data to sync.",
  },

  email: {
    name: "Email Agent",
    description: "Reads and sends emails via IMAP and SendGrid/Resend. Can extract verification codes and magic links.",
    capabilities: [
      "Email inbox reading (IMAP)",
      "Email sending (SendGrid/Resend)",
      "Verification code extraction",
      "Magic link extraction",
      "MFA code retrieval",
      "Email search and filtering",
    ],
    inputs: [
      "search criteria (from, subject, date)",
      "email content to send",
      "recipient address",
    ],
    outputs: [
      "emails",
      "verificationCode",
      "magicLink",
      "sendStatus",
    ],
    typicalDuration: "medium",
    canRunInBackground: true,
    whenToUse: "When needing to read emails (MFA codes, verification links), or sending follow-up emails.",
    whenNotToUse: "If email is not configured, or for simple WhatsApp-based communication.",
  },
};

/**
 * Get a formatted description of all agents for Claude's system prompt
 */
export function getAgentDescriptionsForPrompt(): string {
  const agentDescriptions = Object.entries(AGENT_CAPABILITIES)
    .filter(([type]) => type !== "orchestrator") // Exclude orchestrator from list
    .map(([type, cap]) => {
      const deps = cap.dependsOn?.length
        ? `\n   - Dependencies: ${cap.dependsOn.join(", ")}`
        : "";
      const background = cap.canRunInBackground
        ? " (can run in background)"
        : "";

      return `- **${cap.name}** (\`${type}\`)${background}
   - ${cap.description}
   - Inputs: ${cap.inputs.join(", ")}
   - Outputs: ${cap.outputs.join(", ")}
   - Duration: ${cap.typicalDuration}${deps}
   - Use when: ${cap.whenToUse}`;
    })
    .join("\n\n");

  return `## Available Agents

${agentDescriptions}`;
}

/**
 * Get agent capability by type
 */
export function getAgentCapability(type: AgentType): AgentCapability | undefined {
  return AGENT_CAPABILITIES[type];
}

/**
 * Get agents that can run in background
 */
export function getBackgroundAgents(): AgentType[] {
  return Object.entries(AGENT_CAPABILITIES)
    .filter(([_, cap]) => cap.canRunInBackground)
    .map(([type]) => type as AgentType);
}

/**
 * Get agents that depend on a specific agent
 */
export function getAgentsDependingOn(type: AgentType): AgentType[] {
  return Object.entries(AGENT_CAPABILITIES)
    .filter(([_, cap]) => cap.dependsOn?.includes(type))
    .map(([t]) => t as AgentType);
}

/**
 * Validate an agent invocation chain for dependency correctness
 */
export function validateInvocationChain(
  invocations: Array<{ agentType: AgentType; dependsOn?: string[] }>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const invocationOrder = invocations.map((i) => i.agentType);

  for (const invocation of invocations) {
    const capability = AGENT_CAPABILITIES[invocation.agentType];
    if (!capability) {
      errors.push(`Unknown agent type: ${invocation.agentType}`);
      continue;
    }

    // Check if required dependencies are present
    if (capability.dependsOn) {
      for (const dep of capability.dependsOn) {
        const depIndex = invocationOrder.indexOf(dep);
        const currentIndex = invocationOrder.indexOf(invocation.agentType);

        if (depIndex === -1) {
          errors.push(
            `${invocation.agentType} depends on ${dep}, but ${dep} is not in the invocation chain`
          );
        } else if (depIndex >= currentIndex) {
          errors.push(
            `${invocation.agentType} depends on ${dep}, but ${dep} comes after it in the chain`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
