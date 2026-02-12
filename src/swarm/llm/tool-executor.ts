import type { Logger } from "pino";
import { createLogger, logEvent, logError } from "../../observability/logger.js";
import type { ToolCall, ToolResult, ToolDefinition, AgentContext } from "../types.js";

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: AgentContext
) => Promise<unknown>;

/**
 * Registered tool with definition and handler
 */
export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Tool executor manages tool registration and execution
 */
export class ToolExecutor {
  private tools: Map<string, RegisteredTool> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = createLogger({ component: "tool-executor" });
  }

  /**
   * Register a tool with its handler
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      this.logger.warn({ toolName: definition.name }, "Overwriting existing tool registration");
    }

    this.tools.set(definition.name, { definition, handler });
    logEvent(this.logger, "tool_registered", { toolName: definition.name });
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Array<{ definition: ToolDefinition; handler: ToolHandler }>): void {
    for (const tool of tools) {
      this.registerTool(tool.definition, tool.handler);
    }
  }

  /**
   * Get all registered tool definitions
   */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get tool definitions by name
   */
  getToolDefinitionsByName(names: string[]): ToolDefinition[] {
    return names
      .map((name) => this.tools.get(name)?.definition)
      .filter((d): d is ToolDefinition => d !== undefined);
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a single tool call
   */
  async executeTool(call: ToolCall, context: AgentContext): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(call.name);

    if (!tool) {
      return {
        toolCallId: call.id,
        result: null,
        error: `Unknown tool: ${call.name}`,
      };
    }

    try {
      context.logger.debug(
        { toolName: call.name, input: call.input },
        "Executing tool"
      );

      const result = await tool.handler(call.input, context);
      const durationMs = Date.now() - startTime;

      logEvent(context.logger, "tool_executed", {
        toolName: call.name,
        durationMs,
        success: true,
      });

      return {
        toolCallId: call.id,
        result,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logError(context.logger, error as Error, "Tool execution failed", {
        toolName: call.name,
        durationMs,
      });

      return {
        toolCallId: call.id,
        result: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeTools(
    calls: ToolCall[],
    context: AgentContext
  ): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.executeTool(call, context)));
  }

  /**
   * Create a tool execution function for use with LLMClient.runWithTools
   */
  createExecutor(context: AgentContext): (call: ToolCall) => Promise<string> {
    return async (call: ToolCall): Promise<string> => {
      const result = await this.executeTool(call, context);

      if (result.error) {
        return JSON.stringify({ error: result.error });
      }

      // Serialize result to string for Claude
      if (typeof result.result === "string") {
        return result.result;
      }

      return JSON.stringify(result.result, null, 2);
    };
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}

// Singleton instance
let instance: ToolExecutor | null = null;

/**
 * Get the singleton tool executor
 */
export function getToolExecutor(): ToolExecutor {
  if (!instance) {
    instance = new ToolExecutor();
  }
  return instance;
}

/**
 * Create a new tool executor instance
 */
export function createToolExecutor(): ToolExecutor {
  return new ToolExecutor();
}

/**
 * Reset the singleton (for testing)
 */
export function resetToolExecutor(): void {
  instance = null;
}

/**
 * Helper to create a tool definition
 */
export function defineTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required?: string[]
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
    },
  };
}
