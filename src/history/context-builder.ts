import type { Logger } from "pino";
import { createLogger, logEvent } from "../observability/logger.js";
import { getMessageStore, type MessageStore } from "./message-store.js";
import type { ConversationMessage, Channel } from "../swarm/types.js";
import type { NetworkingContact } from "../config/types.js";

/**
 * Default token budget for conversation context
 */
export const DEFAULT_TOKEN_BUDGET = 8000;

/**
 * Average characters per token (approximation for Claude)
 */
const CHARS_PER_TOKEN = 4;

/**
 * Context builder configuration
 */
export interface ContextBuilderConfig {
  tokenBudget?: number;
  maxMessages?: number;
  includeSystemContext?: boolean;
}

/**
 * Built context result
 */
export interface BuiltContext {
  messages: ConversationMessage[];
  systemContext?: string;
  estimatedTokens: number;
  truncated: boolean;
  messageCount: number;
}

/**
 * ContextBuilder - Manages conversation context for LLM prompts
 *
 * Responsibilities:
 * - Build context from message history
 * - Manage token budget
 * - Prioritize recent and relevant messages
 * - Include contact information as system context
 */
export class ContextBuilder {
  private messageStore: MessageStore;
  private config: Required<ContextBuilderConfig>;
  private logger: Logger;

  constructor(config?: ContextBuilderConfig, messageStore?: MessageStore) {
    this.config = {
      tokenBudget: config?.tokenBudget || DEFAULT_TOKEN_BUDGET,
      maxMessages: config?.maxMessages || 20,
      includeSystemContext: config?.includeSystemContext ?? true,
    };
    this.messageStore = messageStore || getMessageStore();
    this.logger = createLogger({ component: "context-builder" });
  }

  /**
   * Build context for a conversation
   */
  async buildContext(
    phoneNumber: string,
    contact?: NetworkingContact | null,
    newMessage?: string
  ): Promise<BuiltContext> {
    const startTime = Date.now();

    // Get recent messages
    const messages = await this.messageStore.getRecentMessages(
      phoneNumber,
      this.config.maxMessages
    );

    // Build system context if we have contact info
    let systemContext: string | undefined;
    let systemContextTokens = 0;

    if (this.config.includeSystemContext && contact) {
      systemContext = this.buildContactSystemContext(contact);
      systemContextTokens = this.estimateTokens(systemContext);
    }

    // Calculate remaining budget for messages
    const messageBudget = this.config.tokenBudget - systemContextTokens;

    // Build messages within budget
    const { selectedMessages, truncated, totalTokens } = this.selectMessagesWithinBudget(
      messages,
      messageBudget
    );

    const durationMs = Date.now() - startTime;

    logEvent(this.logger, "context_built", {
      phoneNumber,
      messageCount: selectedMessages.length,
      totalMessages: messages.length,
      estimatedTokens: totalTokens + systemContextTokens,
      truncated,
      durationMs,
    });

    return {
      messages: selectedMessages,
      systemContext,
      estimatedTokens: totalTokens + systemContextTokens,
      truncated,
      messageCount: selectedMessages.length,
    };
  }

  /**
   * Build contact information as system context
   */
  private buildContactSystemContext(contact: NetworkingContact): string {
    const lines: string[] = ["## Contact Information"];

    if (contact.first_name) {
      lines.push(`Name: ${contact.first_name}${contact.last_name ? " " + contact.last_name : ""}`);
    }
    lines.push(`Phone: ${contact.phone_number}`);

    if (contact.email) lines.push(`Email: ${contact.email}`);
    if (contact.company_name) lines.push(`Company: ${contact.company_name}`);
    if (contact.job_title) lines.push(`Role: ${contact.job_title}`);
    if (contact.industry) lines.push(`Industry: ${contact.industry}`);
    if (contact.linkedin_url) lines.push(`LinkedIn: ${contact.linkedin_url}`);
    if (contact.event_name) lines.push(`Met at: ${contact.event_name}`);
    if (contact.status) lines.push(`Status: ${contact.status}`);

    // Add meeting info if scheduled
    if (contact.calendly_scheduled_at) {
      lines.push(`Meeting scheduled: ${new Date(contact.calendly_scheduled_at).toLocaleString()}`);
    }

    // Add CRM sync status
    if (contact.crm_synced_at) {
      lines.push(`CRM synced: ${contact.crm_contact_id}`);
    }

    return lines.join("\n");
  }

  /**
   * Select messages that fit within the token budget
   */
  private selectMessagesWithinBudget(
    messages: ConversationMessage[],
    budget: number
  ): {
    selectedMessages: ConversationMessage[];
    truncated: boolean;
    totalTokens: number;
  } {
    const selectedMessages: ConversationMessage[] = [];
    let totalTokens = 0;
    let truncated = false;

    // Process messages from oldest to newest (they come in chronological order)
    // But we prioritize recent messages, so we may need to drop older ones
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageTokens = this.estimateMessageTokens(message);

      if (totalTokens + messageTokens <= budget) {
        selectedMessages.unshift(message); // Add to front to maintain order
        totalTokens += messageTokens;
      } else {
        truncated = true;
        // We've hit the budget, stop adding messages
        break;
      }
    }

    return { selectedMessages, truncated, totalTokens };
  }

  /**
   * Estimate tokens for a message
   */
  private estimateMessageTokens(message: ConversationMessage): number {
    let content = message.content || "";

    // Add overhead for role markers and formatting
    const overhead = 10; // ~10 tokens for role/formatting

    // Add tool calls content if present
    if (message.toolCalls && message.toolCalls.length > 0) {
      content += JSON.stringify(message.toolCalls);
    }

    return this.estimateTokens(content) + overhead;
  }

  /**
   * Estimate tokens for a string
   */
  private estimateTokens(text: string): number {
    // Simple approximation: ~4 characters per token for English text
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Format messages for LLM prompt
   */
  formatMessagesForPrompt(messages: ConversationMessage[]): string {
    return messages
      .map((msg) => {
        const role = msg.direction === "inbound" ? "User" : "Assistant";
        const time = msg.createdAt.toLocaleTimeString();
        return `[${time}] ${role}: ${msg.content}`;
      })
      .join("\n\n");
  }

  /**
   * Get a summary of the conversation
   */
  async getSummary(phoneNumber: string): Promise<{
    messageCount: number;
    firstMessage?: Date;
    lastMessage?: Date;
    inboundCount: number;
    outboundCount: number;
  }> {
    const messages = await this.messageStore.getMessagesByPhone(phoneNumber, {
      limit: 100,
      order: "asc",
    });

    if (messages.length === 0) {
      return {
        messageCount: 0,
        inboundCount: 0,
        outboundCount: 0,
      };
    }

    const inboundCount = messages.filter((m) => m.direction === "inbound").length;
    const outboundCount = messages.filter((m) => m.direction === "outbound").length;

    return {
      messageCount: messages.length,
      firstMessage: messages[0].createdAt,
      lastMessage: messages[messages.length - 1].createdAt,
      inboundCount,
      outboundCount,
    };
  }

  /**
   * Check if token budget allows for more messages
   */
  hasRoomForMessage(currentTokens: number, newMessageLength: number): boolean {
    const newMessageTokens = this.estimateTokens(newMessageLength.toString()) + 10;
    return currentTokens + newMessageTokens <= this.config.tokenBudget;
  }

  /**
   * Get remaining token budget
   */
  getRemainingBudget(currentTokens: number): number {
    return Math.max(0, this.config.tokenBudget - currentTokens);
  }
}

/**
 * Create a context builder with default settings
 */
export function createContextBuilder(
  config?: ContextBuilderConfig,
  messageStore?: MessageStore
): ContextBuilder {
  return new ContextBuilder(config, messageStore);
}

// Singleton instance
let instance: ContextBuilder | null = null;

/**
 * Get or create the context builder instance
 */
export function getContextBuilder(config?: ContextBuilderConfig): ContextBuilder {
  if (!instance) {
    instance = new ContextBuilder(config);
  }
  return instance;
}

/**
 * Reset the context builder (for testing)
 */
export function resetContextBuilder(): void {
  instance = null;
}
