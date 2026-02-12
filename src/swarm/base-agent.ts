import type { Logger } from "pino";
import { createAgentLogger, logAgentActivity } from "../observability/logger.js";
import { LLMClient, getLLMClient } from "./llm/client.js";
import { ToolExecutor, createToolExecutor } from "./llm/tool-executor.js";
import type {
  AgentType,
  AgentContext,
  AgentResult,
  ToolDefinition,
  ToolCall,
  LLMRequest,
} from "./types.js";

/**
 * Configuration for an agent
 */
export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Abstract base class for all swarm agents
 */
export abstract class BaseAgent {
  protected readonly config: AgentConfig;
  protected readonly logger: Logger;
  protected readonly llmClient: LLMClient;
  protected readonly toolExecutor: ToolExecutor;
  protected readonly agentId: string;

  constructor(config: AgentConfig, llmClient?: LLMClient) {
    this.config = config;
    this.agentId = `${config.type}-${Date.now()}`;
    this.logger = createAgentLogger(config.type, this.agentId);
    this.llmClient = llmClient || getLLMClient();
    this.toolExecutor = createToolExecutor();

    // Register agent-specific tools
    this.registerTools();
  }

  /**
   * Get the agent type
   */
  get type(): AgentType {
    return this.config.type;
  }

  /**
   * Get the agent name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get the system prompt for this agent
   */
  protected abstract getSystemPrompt(context: AgentContext): string;

  /**
   * Get the tools available to this agent
   */
  protected abstract getTools(): ToolDefinition[];

  /**
   * Register tool handlers for this agent
   */
  protected abstract registerTools(): void;

  /**
   * Process a task and return a result
   */
  async process(context: AgentContext, input: string): Promise<AgentResult> {
    const startTime = Date.now();
    const agentLogger = context.logger.child({
      agentType: this.config.type,
      agentId: this.agentId,
    });

    logAgentActivity(agentLogger, {
      agentType: this.config.type,
      action: "process",
      status: "started",
      contactId: context.contact?.id,
    });

    try {
      const result = await this.executeWithTools(context, input);
      const durationMs = Date.now() - startTime;

      logAgentActivity(agentLogger, {
        agentType: this.config.type,
        action: "process",
        status: "completed",
        durationMs,
        contactId: context.contact?.id,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logAgentActivity(agentLogger, {
        agentType: this.config.type,
        action: "process",
        status: "failed",
        durationMs,
        contactId: context.contact?.id,
        error: errorMessage,
      });

      return {
        success: false,
        agentType: this.config.type,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute the agent with tool support
   */
  protected async executeWithTools(
    context: AgentContext,
    input: string
  ): Promise<AgentResult> {
    const systemPrompt = this.getSystemPrompt(context);
    const tools = this.getTools();

    // Build messages from conversation history
    const messages = this.buildMessages(context, input);

    const request: LLMRequest = {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    };

    // Execute with tool use support
    const executor = this.toolExecutor.createExecutor(context);
    const response = await this.llmClient.runWithTools(request, executor);

    return {
      success: true,
      agentType: this.config.type,
      response: response.content,
      toolCalls: response.toolCalls,
      tokensUsed: {
        input: response.usage.inputTokens,
        output: response.usage.outputTokens,
      },
      nextAgent: this.determineNextAgent(response.content, response.toolCalls),
    };
  }

  /**
   * Build message array from context and new input
   */
  protected buildMessages(
    context: AgentContext,
    input: string
  ): LLMRequest["messages"] {
    const messages: LLMRequest["messages"] = [];

    // Add conversation history if available
    if (context.messageHistory && context.messageHistory.length > 0) {
      for (const msg of context.messageHistory) {
        messages.push({
          role: msg.direction === "inbound" ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    // Add the new user input
    messages.push({
      role: "user",
      content: input,
    });

    return messages;
  }

  /**
   * Determine if another agent should handle the next step
   * Override in subclasses for custom routing logic
   */
  protected determineNextAgent(
    response: string,
    toolCalls?: ToolCall[]
  ): AgentType | undefined {
    // Default: no handoff
    return undefined;
  }

  /**
   * Simple completion without tools (for agents that don't need them)
   */
  protected async simpleCompletion(
    context: AgentContext,
    input: string
  ): Promise<AgentResult> {
    const systemPrompt = this.getSystemPrompt(context);

    const response = await this.llmClient.chat(systemPrompt, input, {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    });

    return {
      success: true,
      agentType: this.config.type,
      response,
    };
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    // Override in subclasses to define supported actions
    return true;
  }

  /**
   * Get agent metadata for logging/debugging
   */
  getMetadata(): Record<string, unknown> {
    return {
      type: this.config.type,
      name: this.config.name,
      agentId: this.agentId,
      model: this.config.model || "default",
      tools: this.getTools().map((t) => t.name),
    };
  }
}

/**
 * Factory function type for creating agents
 */
export type AgentFactory = (llmClient?: LLMClient) => BaseAgent;

/**
 * Registry of agent factories
 */
const agentFactories: Map<AgentType, AgentFactory> = new Map();

/**
 * Register an agent factory
 */
export function registerAgentFactory(type: AgentType, factory: AgentFactory): void {
  agentFactories.set(type, factory);
}

/**
 * Create an agent by type
 */
export function createAgent(type: AgentType, llmClient?: LLMClient): BaseAgent {
  const factory = agentFactories.get(type);
  if (!factory) {
    throw new Error(`No factory registered for agent type: ${type}`);
  }
  return factory(llmClient);
}

/**
 * Get all registered agent types
 */
export function getRegisteredAgentTypes(): AgentType[] {
  return Array.from(agentFactories.keys());
}
