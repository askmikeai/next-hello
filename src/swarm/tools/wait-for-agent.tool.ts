/**
 * Wait For Agent Tool - wait_for_agent
 *
 * This tool allows Claude to wait for a previously triggered background agent
 * to complete and retrieve its results. Useful when an agent was triggered
 * with waitForResults=false but results are now needed.
 */

import type { ToolDefinition, AgentType, AgentContext, AgentResult } from "../types.js";
import type { ToolHandler } from "../llm/tool-executor.js";
import { defineTool } from "../llm/tool-executor.js";
import { getRedisConnection } from "../../queue/client.js";

/**
 * Input for wait_for_agent tool
 */
export interface WaitForAgentInput {
  /** The agent type to wait for */
  agentType: AgentType;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Status of a background agent
 */
export type AgentExecutionStatus = "pending" | "in_progress" | "completed" | "failed" | "not_found";

/**
 * Result from wait_for_agent tool
 */
export interface WaitForAgentResult {
  /** The agent type checked */
  agentType: AgentType;
  /** Current status of the agent */
  status: AgentExecutionStatus;
  /** Whether results are available */
  hasResults: boolean;
  /** The agent's response (if completed) */
  response?: string;
  /** Structured data from the agent (if completed) */
  data?: Record<string, unknown>;
  /** Error message (if failed) */
  error?: string;
  /** Time spent waiting in milliseconds */
  waitedMs?: number;
  /** Guidance on what to do next */
  guidance: string;
}

/**
 * Key prefix for storing agent execution state in Redis
 */
const AGENT_STATE_PREFIX = "swarm:agent:";

/**
 * Get the wait_for_agent tool definition
 */
export function getWaitForAgentToolDefinition(): ToolDefinition {
  return defineTool(
    "wait_for_agent",
    `Wait for a background agent to complete and get its results.

Use when:
- You triggered agents with waitForResults=false earlier
- You now need the results to inform your response
- User is asking about the status of a background task

Example:
{
  "agentType": "research",
  "timeoutMs": 10000
}`,
    {
      agentType: {
        type: "string",
        enum: ["research", "qualification", "personalization", "video", "voice", "crm"],
        description: "The agent type to wait for",
      },
      timeoutMs: {
        type: "number",
        description: "Maximum time to wait in milliseconds (default: 30000)",
      },
    },
    ["agentType"]
  );
}

/**
 * Get agent state from Redis
 */
async function getAgentState(
  phoneNumber: string,
  agentType: AgentType
): Promise<{
  status: AgentExecutionStatus;
  result?: AgentResult;
  startedAt?: Date;
  completedAt?: Date;
} | null> {
  const redis = getRedisConnection();
  if (!redis) return null;

  try {
    const key = `${AGENT_STATE_PREFIX}${phoneNumber}:${agentType}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Store agent state in Redis
 */
export async function setAgentState(
  phoneNumber: string,
  agentType: AgentType,
  state: {
    status: AgentExecutionStatus;
    result?: AgentResult;
    startedAt?: Date;
    completedAt?: Date;
  }
): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) return;

  try {
    const key = `${AGENT_STATE_PREFIX}${phoneNumber}:${agentType}`;
    // Store with 1 hour TTL
    await redis.setex(key, 3600, JSON.stringify(state));
  } catch {
    // Ignore Redis errors
  }
}

/**
 * Clear agent state from Redis
 */
export async function clearAgentState(
  phoneNumber: string,
  agentType: AgentType
): Promise<void> {
  const redis = getRedisConnection();
  if (!redis) return;

  try {
    const key = `${AGENT_STATE_PREFIX}${phoneNumber}:${agentType}`;
    await redis.del(key);
  } catch {
    // Ignore Redis errors
  }
}

/**
 * Create the handler for wait_for_agent tool
 */
export function createWaitForAgentToolHandler(): ToolHandler {
  return async (
    input: Record<string, unknown>,
    context: AgentContext
  ): Promise<WaitForAgentResult> => {
    const agentType = input.agentType as AgentType;
    const timeoutMs = (input.timeoutMs as number) || 30000;
    const startTime = Date.now();

    const phoneNumber = context.phoneNumber;
    if (!phoneNumber) {
      return {
        agentType,
        status: "not_found",
        hasResults: false,
        guidance: "No phone number in context - cannot look up agent state.",
      };
    }

    context.logger.info(
      { agentType, phoneNumber, timeoutMs },
      "Waiting for agent"
    );

    // Poll for completion
    const pollInterval = 1000; // 1 second
    let elapsed = 0;

    while (elapsed < timeoutMs) {
      const state = await getAgentState(phoneNumber, agentType);

      if (!state) {
        // No state found - agent may not have been triggered
        if (elapsed > 5000) {
          // Give it a few seconds before declaring not found
          return {
            agentType,
            status: "not_found",
            hasResults: false,
            waitedMs: elapsed,
            guidance: `No ${agentType} agent execution found for this contact. It may not have been triggered, or it completed before state was stored.`,
          };
        }
      } else if (state.status === "completed") {
        return {
          agentType,
          status: "completed",
          hasResults: true,
          response: state.result?.response,
          data: state.result?.data,
          waitedMs: Date.now() - startTime,
          guidance: `${agentType} agent completed successfully. Results are available.`,
        };
      } else if (state.status === "failed") {
        return {
          agentType,
          status: "failed",
          hasResults: false,
          error: state.result?.error,
          waitedMs: Date.now() - startTime,
          guidance: `${agentType} agent failed: ${state.result?.error}. You may want to retry or inform the user.`,
        };
      }

      // Still pending or in_progress - wait and poll again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed = Date.now() - startTime;
    }

    // Timeout reached
    const finalState = await getAgentState(phoneNumber, agentType);

    return {
      agentType,
      status: finalState?.status || "not_found",
      hasResults: false,
      waitedMs: elapsed,
      guidance: `Timed out waiting for ${agentType} agent after ${Math.round(elapsed / 1000)}s. The agent may still be running. You can try again later or inform the user that processing is taking longer than expected.`,
    };
  };
}

/**
 * Get all pending agent results for a phone number
 */
export async function getPendingAgentResults(
  phoneNumber: string
): Promise<Record<AgentType, WaitForAgentResult>> {
  const redis = getRedisConnection();
  const results: Record<string, WaitForAgentResult> = {};

  if (!redis) return results as Record<AgentType, WaitForAgentResult>;

  const agentTypes: AgentType[] = [
    "research",
    "qualification",
    "personalization",
    "video",
    "voice",
    "crm",
  ];

  for (const agentType of agentTypes) {
    const state = await getAgentState(phoneNumber, agentType);
    if (state) {
      results[agentType] = {
        agentType,
        status: state.status,
        hasResults: state.status === "completed",
        response: state.result?.response,
        data: state.result?.data,
        error: state.result?.error,
        guidance: "",
      };
    }
  }

  return results as Record<AgentType, WaitForAgentResult>;
}
