/**
 * Invoke Agents Tool - invoke_agents
 *
 * This is the core tool for dynamic agent orchestration. It allows Claude
 * to invoke specialized agents, specify dependencies between them, and
 * optionally wait for results to inform the response.
 */

import type { ToolDefinition, AgentType, AgentContext, AgentResult } from "../types.js";
import type { ToolHandler } from "../llm/tool-executor.js";
import { defineTool } from "../llm/tool-executor.js";
import { createAgent, getRegisteredAgentTypes } from "../base-agent.js";
import { AGENT_CAPABILITIES, validateInvocationChain } from "../registry/agent-registry.js";
import { createCorrelationId } from "../../observability/logger.js";

/**
 * Execution strategy for agent invocations
 */
export type InvocationStrategy = "parallel" | "sequential" | "custom_dependencies";

/**
 * Single agent invocation request
 */
export interface AgentInvocation {
  /** The agent type to invoke */
  agentType: AgentType;
  /** Action/task description for the agent */
  action: string;
  /** Input data for the agent */
  input: Record<string, unknown>;
  /** Task IDs this invocation depends on (for custom_dependencies) */
  dependsOn?: string[];
  /** Reason for invoking this agent */
  reason: string;
}

/**
 * Input for invoke_agents tool
 */
export interface InvokeAgentsInput {
  /** List of agent invocations */
  invocations: AgentInvocation[];
  /** Execution strategy */
  strategy: InvocationStrategy;
  /** Whether to wait for results before returning */
  waitForResults: boolean;
  /** Timeout in milliseconds (for waitForResults) */
  timeoutMs?: number;
}

/**
 * Result from a single agent invocation
 */
export interface InvocationResult {
  /** Agent type that was invoked */
  agentType: AgentType;
  /** Whether the invocation succeeded */
  success: boolean;
  /** Agent's response/output */
  response?: string;
  /** Structured data from the agent */
  data?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

/**
 * Result from invoke_agents tool
 */
export interface InvokeAgentsResult {
  /** Whether all invocations were triggered successfully */
  triggered: boolean;
  /** Number of agents invoked */
  agentCount: number;
  /** Execution strategy used */
  strategy: InvocationStrategy;
  /** Whether we waited for results */
  waitedForResults: boolean;
  /** Results from agents (if waitForResults was true) */
  results?: InvocationResult[];
  /** Merged data from all successful agents */
  mergedData?: Record<string, unknown>;
  /** Summary of what happened */
  summary: string;
  /** Any validation errors */
  errors?: string[];
}

/**
 * Get the invoke_agents tool definition
 */
export function getInvokeAgentsToolDefinition(): ToolDefinition {
  return defineTool(
    "invoke_agents",
    `Invoke specialized agents with dynamic dependencies. Use after decide_strategy chooses "agent_orchestration".

Strategies:
- "parallel": Run all agents concurrently (fastest, no dependencies)
- "sequential": Run agents one after another in order given
- "custom_dependencies": Run based on dependsOn relationships

Set waitForResults=true if you need the data to inform your response.
Set waitForResults=false for fire-and-forget background tasks.

Example for researching a contact:
{
  "invocations": [
    {"agentType": "research", "action": "pdl_enrich", "input": {"email": "john@acme.com"}, "reason": "User requested lookup"}
  ],
  "strategy": "parallel",
  "waitForResults": true
}

Example with dependencies (research before qualification):
{
  "invocations": [
    {"agentType": "research", "action": "pdl_enrich", "input": {...}, "reason": "Get background data"},
    {"agentType": "qualification", "action": "score_lead", "input": {}, "dependsOn": ["research"], "reason": "Score after enrichment"}
  ],
  "strategy": "custom_dependencies",
  "waitForResults": true
}`,
    {
      invocations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agentType: {
              type: "string",
              enum: ["research", "qualification", "personalization", "video", "voice", "crm"],
              description: "The agent type to invoke",
            },
            action: {
              type: "string",
              description: "Action/task for the agent (e.g., 'pdl_enrich', 'score_lead')",
            },
            input: {
              type: "object",
              description: "Input data for the agent",
            },
            dependsOn: {
              type: "array",
              items: { type: "string" },
              description: "Agent types this depends on (for custom_dependencies)",
            },
            reason: {
              type: "string",
              description: "Why this agent is being invoked",
            },
          },
          required: ["agentType", "action", "input", "reason"],
        },
        description: "List of agents to invoke",
      },
      strategy: {
        type: "string",
        enum: ["parallel", "sequential", "custom_dependencies"],
        description: "How to execute the invocations",
      },
      waitForResults: {
        type: "boolean",
        description: "Whether to wait for agent results before returning",
      },
      timeoutMs: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000 for immediate, 60000 for background)",
      },
    },
    ["invocations", "strategy", "waitForResults"]
  );
}

/**
 * Execute agents in parallel
 */
async function executeParallel(
  invocations: AgentInvocation[],
  context: AgentContext,
  timeoutMs: number
): Promise<InvocationResult[]> {
  const promises = invocations.map(async (inv) => {
    const startTime = Date.now();
    try {
      const agent = createAgent(inv.agentType);
      const result = await Promise.race([
        agent.process(context, JSON.stringify({ action: inv.action, ...inv.input })),
        new Promise<AgentResult>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), timeoutMs)
        ),
      ]);

      return {
        agentType: inv.agentType,
        success: result.success,
        response: result.response,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        agentType: inv.agentType,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      };
    }
  });

  return Promise.all(promises);
}

/**
 * Execute agents sequentially
 */
async function executeSequential(
  invocations: AgentInvocation[],
  context: AgentContext,
  timeoutMs: number
): Promise<InvocationResult[]> {
  const results: InvocationResult[] = [];
  const dataStore: Record<string, unknown> = {};

  for (const inv of invocations) {
    const startTime = Date.now();
    try {
      const agent = createAgent(inv.agentType);

      // Inject previous results into input
      const enrichedInput = {
        action: inv.action,
        ...inv.input,
        previousResults: dataStore,
      };

      const result = await Promise.race([
        agent.process(context, JSON.stringify(enrichedInput)),
        new Promise<AgentResult>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), timeoutMs)
        ),
      ]);

      const invocationResult: InvocationResult = {
        agentType: inv.agentType,
        success: result.success,
        response: result.response,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };

      results.push(invocationResult);

      // Store data for subsequent agents
      if (result.success && result.data) {
        dataStore[inv.agentType] = result.data;
      }
    } catch (error) {
      results.push({
        agentType: inv.agentType,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: Date.now() - startTime,
      });
    }
  }

  return results;
}

/**
 * Execute agents with custom dependencies using topological sort
 */
async function executeWithDependencies(
  invocations: AgentInvocation[],
  context: AgentContext,
  timeoutMs: number
): Promise<InvocationResult[]> {
  const results: InvocationResult[] = [];
  const completed = new Set<AgentType>();
  const dataStore: Record<string, unknown> = {};

  // Create a map for quick lookup
  const invocationMap = new Map(invocations.map((inv) => [inv.agentType, inv]));

  // Process invocations in dependency order
  while (completed.size < invocations.length) {
    // Find invocations whose dependencies are satisfied
    const ready = invocations.filter((inv) => {
      if (completed.has(inv.agentType)) return false;

      // Check if all dependencies are satisfied
      const deps = inv.dependsOn || [];
      // Also check agent's built-in dependencies
      const agentCap = AGENT_CAPABILITIES[inv.agentType];
      const allDeps = [...deps, ...(agentCap?.dependsOn || [])];

      return allDeps.every((dep) => completed.has(dep as AgentType));
    });

    if (ready.length === 0) {
      // No ready tasks but not all complete - circular dependency or missing agent
      const remaining = invocations.filter((inv) => !completed.has(inv.agentType));
      for (const inv of remaining) {
        results.push({
          agentType: inv.agentType,
          success: false,
          error: "Unsatisfied dependencies",
        });
        completed.add(inv.agentType);
      }
      break;
    }

    // Execute ready invocations in parallel
    const readyResults = await Promise.all(
      ready.map(async (inv) => {
        const startTime = Date.now();
        try {
          const agent = createAgent(inv.agentType);

          // Inject dependency results into input
          const enrichedInput = {
            action: inv.action,
            ...inv.input,
            dependencyResults: Object.fromEntries(
              (inv.dependsOn || []).map((dep) => [dep, dataStore[dep]])
            ),
          };

          const result = await Promise.race([
            agent.process(context, JSON.stringify(enrichedInput)),
            new Promise<AgentResult>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), timeoutMs)
            ),
          ]);

          return {
            agentType: inv.agentType,
            success: result.success,
            response: result.response,
            data: result.data,
            error: result.error,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            agentType: inv.agentType,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            durationMs: Date.now() - startTime,
          };
        }
      })
    );

    // Mark as completed and store data
    for (const result of readyResults) {
      results.push(result);
      completed.add(result.agentType);
      if (result.success && result.data) {
        dataStore[result.agentType] = result.data;
      }
    }
  }

  return results;
}

/**
 * Merge data from multiple agent results
 */
function mergeAgentData(results: InvocationResult[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const result of results) {
    if (result.success && result.data) {
      merged[result.agentType] = result.data;
    }
  }

  return merged;
}

/**
 * Create the handler for invoke_agents tool
 */
export function createInvokeAgentsToolHandler(): ToolHandler {
  return async (
    input: Record<string, unknown>,
    context: AgentContext
  ): Promise<InvokeAgentsResult> => {
    const invocations = input.invocations as AgentInvocation[];
    const strategy = input.strategy as InvocationStrategy;
    const waitForResults = input.waitForResults as boolean;
    const timeoutMs = (input.timeoutMs as number) || (waitForResults ? 30000 : 60000);

    // Validate invocations
    const registeredTypes = getRegisteredAgentTypes();
    const errors: string[] = [];

    for (const inv of invocations) {
      if (!registeredTypes.includes(inv.agentType)) {
        errors.push(`Agent type "${inv.agentType}" is not registered`);
      }
    }

    // Validate dependency chain for custom_dependencies
    if (strategy === "custom_dependencies") {
      const chainValidation = validateInvocationChain(invocations);
      if (!chainValidation.valid) {
        errors.push(...chainValidation.errors);
      }
    }

    if (errors.length > 0) {
      context.logger.warn({ errors, invocations }, "Invalid agent invocations");
      return {
        triggered: false,
        agentCount: 0,
        strategy,
        waitedForResults: false,
        summary: `Failed to invoke agents: ${errors.join(", ")}`,
        errors,
      };
    }

    context.logger.info(
      {
        correlationId: context.correlationId,
        strategy,
        waitForResults,
        agents: invocations.map((i) => i.agentType),
      },
      "Invoking agents"
    );

    // If not waiting for results, trigger in background
    if (!waitForResults) {
      // Fire and forget - trigger agents in background
      setImmediate(async () => {
        try {
          switch (strategy) {
            case "parallel":
              await executeParallel(invocations, context, timeoutMs);
              break;
            case "sequential":
              await executeSequential(invocations, context, timeoutMs);
              break;
            case "custom_dependencies":
              await executeWithDependencies(invocations, context, timeoutMs);
              break;
          }
        } catch (error) {
          context.logger.error(
            { error: error instanceof Error ? error.message : "Unknown error" },
            "Background agent execution failed"
          );
        }
      });

      return {
        triggered: true,
        agentCount: invocations.length,
        strategy,
        waitedForResults: false,
        summary: `Triggered ${invocations.length} agent(s) in background: ${invocations
          .map((i) => i.agentType)
          .join(", ")}`,
      };
    }

    // Execute and wait for results
    let results: InvocationResult[];

    switch (strategy) {
      case "parallel":
        results = await executeParallel(invocations, context, timeoutMs);
        break;
      case "sequential":
        results = await executeSequential(invocations, context, timeoutMs);
        break;
      case "custom_dependencies":
        results = await executeWithDependencies(invocations, context, timeoutMs);
        break;
    }

    const successCount = results.filter((r) => r.success).length;
    const mergedData = mergeAgentData(results);

    // Build summary
    const summaryParts: string[] = [];
    for (const result of results) {
      if (result.success) {
        summaryParts.push(`${result.agentType}: success`);
      } else {
        summaryParts.push(`${result.agentType}: failed (${result.error})`);
      }
    }

    return {
      triggered: true,
      agentCount: invocations.length,
      strategy,
      waitedForResults: true,
      results,
      mergedData,
      summary: `${successCount}/${invocations.length} agents succeeded. ${summaryParts.join("; ")}`,
    };
  };
}
