/**
 * Strategy Tool - decide_strategy
 *
 * This tool allows Claude to explicitly decide how to handle a message
 * before taking action. It forces a thoughtful decision about whether
 * to respond directly, use rule-based logic, or orchestrate agents.
 */

import type { ToolDefinition, AgentType, AgentContext, StrategyType } from "../types.js";
import type { ToolHandler } from "../llm/tool-executor.js";
import { defineTool } from "../llm/tool-executor.js";

/**
 * Priority levels for agent invocations
 */
export type PriorityLevel = "immediate" | "background";

/**
 * Input for decide_strategy tool
 */
export interface DecideStrategyInput {
  /** The chosen strategy */
  strategy: StrategyType;
  /** Reasoning for the strategy choice */
  reasoning: string;
  /** Suggested agents if using agent_orchestration */
  suggestedAgents?: AgentType[];
  /** Priority for agent invocations */
  priority?: PriorityLevel;
}

/**
 * Result from decide_strategy tool
 */
export interface DecideStrategyResult {
  /** Whether the strategy was recorded */
  recorded: boolean;
  /** The chosen strategy */
  strategy: StrategyType;
  /** Guidance for next steps */
  guidance: string;
  /** Available agents if agent_orchestration chosen */
  availableAgents?: AgentType[];
}

/**
 * Get the decide_strategy tool definition
 */
export function getStrategyToolDefinition(): ToolDefinition {
  return defineTool(
    "decide_strategy",
    `Decide how to handle this message. Use FIRST before taking other actions.

Strategies:
- "direct_response": Simple conversational reply, no agents needed
- "rule_based": Use existing tools (contact_lookup, contact_update, etc.)
- "agent_orchestration": Invoke specialized agents for complex tasks

Choose agent_orchestration when:
- User wants research/enrichment ("look me up", "research me")
- User shares LinkedIn URL or asks for professional info
- Complex multi-step operations needed
- Lead qualification or scoring needed
- Video/voice generation requested`,
    {
      strategy: {
        type: "string",
        enum: ["direct_response", "rule_based", "agent_orchestration"],
        description: "The strategy to use for handling this message",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of why this strategy was chosen",
      },
      suggestedAgents: {
        type: "array",
        items: { type: "string" },
        description: "Agents to invoke (for agent_orchestration strategy)",
      },
      priority: {
        type: "string",
        enum: ["immediate", "background"],
        description: "Whether results are needed now or can run in background",
      },
    },
    ["strategy", "reasoning"]
  );
}

/**
 * Create the handler for decide_strategy tool
 */
export function createStrategyToolHandler(): ToolHandler {
  return async (input: Record<string, unknown>, context: AgentContext): Promise<DecideStrategyResult> => {
    const strategy = input.strategy as StrategyType;
    const reasoning = input.reasoning as string;
    const suggestedAgents = input.suggestedAgents as AgentType[] | undefined;
    const priority = (input.priority as PriorityLevel) || "immediate";

    context.logger.info(
      {
        strategy,
        reasoning,
        suggestedAgents,
        priority,
        correlationId: context.correlationId,
      },
      "Strategy decided"
    );

    // Build guidance based on strategy
    let guidance: string;
    switch (strategy) {
      case "direct_response":
        guidance = "Respond conversationally. No tools or agents needed.";
        break;

      case "rule_based":
        guidance = "Use standard tools (contact_lookup, contact_update, get_calendly_link, etc.) to handle the request.";
        break;

      case "agent_orchestration":
        if (!suggestedAgents?.length) {
          guidance = "Use invoke_agents to trigger the appropriate agents. Consider: research (for enrichment), qualification (for lead scoring), video (for personalized videos), voice (for voice messages), crm (for HubSpot sync).";
        } else {
          guidance = `Use invoke_agents to trigger: ${suggestedAgents.join(", ")}. ${
            priority === "immediate"
              ? "Wait for results before responding."
              : "Run in background, acknowledge to user."
          }`;
        }
        break;
    }

    return {
      recorded: true,
      strategy,
      guidance,
      availableAgents:
        strategy === "agent_orchestration"
          ? ["research", "qualification", "personalization", "video", "voice", "crm"]
          : undefined,
    };
  };
}

// StrategyDecision is now defined in ../types.ts
