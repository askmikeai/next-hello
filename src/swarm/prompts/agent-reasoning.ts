/**
 * Agent Reasoning Prompts
 *
 * System prompt sections that guide Claude's reasoning about
 * when and how to use specialized agents.
 */

import { getAgentDescriptionsForPrompt } from "../registry/agent-registry.js";
import type { AgentType, AgentResult } from "../types.js";

/**
 * Build the agent selection framework prompt section
 */
export function buildAgentReasoningPrompt(): string {
  const agentDescriptions = getAgentDescriptionsForPrompt();

  return `## Agent Selection Framework

You have access to specialized agents that can perform tasks you cannot do directly.
Use the decision process below to determine when and how to use them.

${agentDescriptions}

### Decision Process

**Step 1: Analyze the Message**
- What is the user asking for?
- What data do we already have about this contact?
- What new information have they provided?

**Step 2: Choose a Strategy (use decide_strategy tool)**
- "direct_response": Simple conversational reply, no agents needed
- "rule_based": Use standard tools (contact_lookup, contact_update, etc.)
- "agent_orchestration": Invoke specialized agents for complex tasks

**Step 3: If Using Agents**
1. Identify which agents are needed
2. Consider dependencies (qualification needs research first)
3. Decide if results are needed immediately or can run in background
4. Use invoke_agents with appropriate strategy

### When to Use agent_orchestration

Use agent orchestration for:
- "Research me" / "Look me up" / "Find my info" → research agent
- User shares LinkedIn URL → research agent
- User shares email + company → research agent
- "Score this lead" / "Am I a good fit?" → qualification agent (after research)
- "Send me a video" / "Create a personalized video" → video agent
- Voice conversation mode → voice agent
- After collecting contact info → crm agent (background)

### Dependency Chains

Some agents need data from others:
- **qualification** depends on **research** - run research first, then qualification
- **personalization** depends on **research** - needs enriched data
- **video** and **voice** can run independently

### Wait for Results vs Background

**Wait for results (waitForResults: true)** when:
- User is asking a question that needs the data
- "Research me" - they want to see the results
- You need the data to craft a personalized response

**Background (waitForResults: false)** when:
- Syncing to CRM after collecting info
- Starting a video generation (takes minutes)
- User doesn't need immediate feedback

### Example Patterns

**Pattern 1: User asks to be researched**
\`\`\`
User: "Can you look me up? My email is john@acme.com"
1. decide_strategy → "agent_orchestration"
2. invoke_agents([{agentType: "research", input: {email: "john@acme.com"}}], waitForResults: true)
3. Use research results to craft informed response
\`\`\`

**Pattern 2: Research + Qualification pipeline**
\`\`\`
User: "Research me and tell me if I'm a good lead"
1. decide_strategy → "agent_orchestration"
2. invoke_agents([
     {agentType: "research", ...},
     {agentType: "qualification", dependsOn: ["research"], ...}
   ], strategy: "custom_dependencies", waitForResults: true)
\`\`\`

**Pattern 3: Background CRM sync**
\`\`\`
User: "My email is john@acme.com, I work at Acme Corp"
1. Update contact with contact_update tool
2. invoke_agents([{agentType: "crm", ...}], waitForResults: false)
3. Respond immediately while CRM syncs in background
\`\`\`
`;
}

/**
 * Build context about recent agent results for the prompt
 */
export function buildAgentResultsContext(
  recentResults: Record<AgentType, AgentResult>
): string {
  const entries = Object.entries(recentResults);
  if (entries.length === 0) return "";

  const resultsSummary = entries
    .map(([agentType, result]) => {
      if (result.success) {
        const dataPreview = result.data
          ? ` Data: ${JSON.stringify(result.data).slice(0, 200)}...`
          : "";
        return `- **${agentType}**: Completed successfully.${dataPreview}`;
      } else {
        return `- **${agentType}**: Failed - ${result.error}`;
      }
    })
    .join("\n");

  return `## Recent Agent Results

The following agents have recently completed for this contact:

${resultsSummary}

You can use this data to inform your response. If you need fresher data, invoke the agents again.
`;
}

/**
 * Build a compact summary of agent results for inline use
 */
export function summarizeAgentResults(
  results: Array<{ agentType: AgentType; success: boolean; data?: Record<string, unknown> }>
): string {
  if (results.length === 0) return "No agent results available.";

  const summaries: string[] = [];

  for (const result of results) {
    if (!result.success) {
      summaries.push(`${result.agentType}: failed`);
      continue;
    }

    switch (result.agentType) {
      case "research":
        if (result.data) {
          const d = result.data as Record<string, string>;
          summaries.push(
            `Research found: ${d.fullName || "name"} - ${d.jobTitle || "title"} at ${d.company || "company"}`
          );
        }
        break;

      case "qualification":
        if (result.data) {
          const d = result.data as Record<string, unknown>;
          summaries.push(
            `Qualification: ${d.tier || "unknown"} lead (score: ${d.score || "?"}/100)`
          );
        }
        break;

      case "video":
        if (result.data) {
          const d = result.data as Record<string, unknown>;
          summaries.push(
            `Video: ${d.status || "unknown"} ${d.videoUrl ? "(ready)" : "(generating)"}`
          );
        }
        break;

      case "voice":
        summaries.push("Voice message: generated");
        break;

      case "crm":
        if (result.data) {
          const d = result.data as Record<string, unknown>;
          summaries.push(`CRM: synced (ID: ${d.crmContactId || "unknown"})`);
        }
        break;

      default:
        summaries.push(`${result.agentType}: completed`);
    }
  }

  return summaries.join("\n");
}

/**
 * Get guidance for when an agent is recommended but not yet invoked
 */
export function getAgentRecommendation(
  contactHas: {
    email?: boolean;
    linkedinUrl?: boolean;
    firstName?: boolean;
    lastName?: boolean;
    companyName?: boolean;
    researchData?: boolean;
    qualificationScore?: boolean;
    video?: boolean;
  }
): string | null {
  // Recommend research if we have lookup info but no research yet
  if (
    !contactHas.researchData &&
    (contactHas.email || contactHas.linkedinUrl || (contactHas.firstName && contactHas.companyName))
  ) {
    return "Consider running the research agent to enrich this contact's professional data.";
  }

  // Recommend qualification if we have research but no score
  if (contactHas.researchData && !contactHas.qualificationScore) {
    return "Consider running the qualification agent to score this lead.";
  }

  // Recommend video if we have enough info and no video yet
  if (contactHas.firstName && contactHas.researchData && !contactHas.video) {
    return "This contact might be a good candidate for a personalized video.";
  }

  return null;
}
