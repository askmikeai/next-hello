import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { logLLMInteraction, createLogger } from "../../observability/logger.js";
import type {
  LLMRequest,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from "../types.js";

/**
 * Default model to use
 */
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Default max tokens for responses
 */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Configuration for the LLM client
 */
export interface LLMClientConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  defaultTemperature?: number;
  timeout?: number;
}

/**
 * Converts our tool definition format to Anthropic's format
 */
function convertToolDefinition(
  tool: ToolDefinition
): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

/**
 * Converts Anthropic's tool use blocks to our ToolCall format
 */
function extractToolCalls(
  content: Anthropic.ContentBlock[]
): ToolCall[] {
  return content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));
}

/**
 * Converts our message format to Anthropic's format
 */
function convertMessages(
  messages: LLMRequest["messages"]
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    // Handle complex content blocks
    const contentBlocks: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
      if (block.type === "text" && block.text) {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use" && block.id && block.name) {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      if (block.type === "tool_result" && block.tool_use_id) {
        return {
          type: "tool_result" as const,
          tool_use_id: block.tool_use_id,
          content: block.content || "",
        };
      }
      // Default text block
      return { type: "text" as const, text: block.text || "" };
    });

    return {
      role: msg.role,
      content: contentBlocks,
    };
  });
}

/**
 * Anthropic Claude client wrapper for the swarm
 */
export class LLMClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private defaultTemperature: number;
  private logger: Logger;

  constructor(config: LLMClientConfig = {}) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is required. Set it in environment or pass to constructor."
      );
    }

    this.client = new Anthropic({
      apiKey,
      timeout: config.timeout || 60000,
    });

    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
    this.logger = createLogger({ component: "llm-client" });
  }

  /**
   * Send a completion request to Claude
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = request.model || this.model;
    const maxTokens = request.maxTokens || this.maxTokens;

    try {
      const anthropicMessages = convertMessages(request.messages);
      const tools = request.tools?.map(convertToolDefinition);

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: request.systemPrompt,
        messages: anthropicMessages,
        tools: tools && tools.length > 0 ? tools : undefined,
        temperature: request.temperature ?? this.defaultTemperature,
      });

      const durationMs = Date.now() - startTime;
      const toolCalls = extractToolCalls(response.content);

      // Extract text content
      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      logLLMInteraction(this.logger, {
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        durationMs,
        toolCalls: toolCalls.map((tc) => tc.name),
        success: true,
      });

      return {
        id: response.id,
        content: textContent,
        stopReason: response.stop_reason || "end_turn",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logLLMInteraction(this.logger, {
        model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs,
        success: false,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Simple text completion without tools
   */
  async chat(
    systemPrompt: string,
    userMessage: string,
    options?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<string> {
    const response = await this.complete({
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      model: options?.model,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    });

    return response.content;
  }

  /**
   * Run a multi-turn conversation with tool use
   */
  async runWithTools(
    request: LLMRequest,
    executeToolCall: (call: ToolCall) => Promise<string>
  ): Promise<LLMResponse> {
    let currentRequest = { ...request };
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;
      const response = await this.complete(currentRequest);

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response;
      }

      // If stop reason is end_turn (not tool_use), we're done
      if (response.stopReason === "end_turn") {
        return response;
      }

      // Execute tool calls and build result message
      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }> = [];

      for (const toolCall of response.toolCalls) {
        try {
          const result = await executeToolCall(toolCall);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Error: ${errorMessage}`,
          });
        }
      }

      // Build the assistant message with tool uses
      const assistantContent: Array<{
        type: "text" | "tool_use";
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }> = [];

      if (response.content) {
        assistantContent.push({ type: "text", text: response.content });
      }

      for (const toolCall of response.toolCalls) {
        assistantContent.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }

      // Add assistant message with tool calls and user message with results
      currentRequest = {
        ...currentRequest,
        messages: [
          ...currentRequest.messages,
          { role: "assistant", content: assistantContent },
          { role: "user", content: toolResults },
        ],
      };
    }

    throw new Error(`Max tool iterations (${maxIterations}) exceeded`);
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Check if the client is configured
   */
  isConfigured(): boolean {
    return !!this.client;
  }
}

// Singleton instance
let instance: LLMClient | null = null;

/**
 * Get or create the singleton LLM client
 */
export function getLLMClient(config?: LLMClientConfig): LLMClient {
  if (!instance) {
    instance = new LLMClient(config);
  }
  return instance;
}

/**
 * Create a new LLM client instance (for testing or custom configs)
 */
export function createLLMClient(config: LLMClientConfig): LLMClient {
  return new LLMClient(config);
}

/**
 * Reset the singleton (for testing)
 */
export function resetLLMClient(): void {
  instance = null;
}
