import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { createLogger, logEvent, logError } from "../observability/logger.js";
import type {
  ConversationMessage,
  MessageDirection,
  Channel,
  ToolCall,
} from "../swarm/types.js";
import type { SupabaseConfig } from "../config/types.js";

/**
 * Message store configuration
 */
export interface MessageStoreConfig {
  supabase?: SupabaseConfig;
  tableName?: string;
}

/**
 * Raw message row from database
 */
interface MessageRow {
  id: string;
  contact_id: string | null;
  phone_number: string;
  correlation_id: string;
  direction: string;
  channel: string;
  content: string;
  agent_id: string | null;
  model_used: string | null;
  tokens_used: number | null;
  tool_calls: unknown | null;
  created_at: string;
}

/**
 * Message creation input
 */
export interface CreateMessageInput {
  contactId?: string;
  phoneNumber: string;
  correlationId: string;
  direction: MessageDirection;
  channel: Channel;
  content: string;
  agentId?: string;
  modelUsed?: string;
  tokensUsed?: number;
  toolCalls?: ToolCall[];
}

const DEFAULT_TABLE = "message_history";

/**
 * MessageStore - Persists conversation messages to Supabase
 */
export class MessageStore {
  private client: SupabaseClient | null = null;
  private tableName: string;
  private logger: Logger;
  private configured: boolean = false;

  constructor(config?: MessageStoreConfig) {
    this.tableName = config?.tableName || config?.supabase?.tableName || DEFAULT_TABLE;
    this.logger = createLogger({ component: "message-store" });

    const supabaseUrl = config?.supabase?.url || process.env.SUPABASE_URL;
    const supabaseKey = config?.supabase?.serviceRoleKey || process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
      this.client = createClient(supabaseUrl, supabaseKey);
      this.configured = true;
      logEvent(this.logger, "message_store_initialized", { tableName: this.tableName });
    } else {
      this.logger.warn("Supabase not configured, message store will use in-memory fallback");
    }
  }

  /**
   * Check if message store is configured
   */
  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Store a new message
   */
  async storeMessage(input: CreateMessageInput): Promise<ConversationMessage | null> {
    if (!this.client) {
      this.logger.debug("Message store not configured, skipping storage");
      return this.createInMemoryMessage(input);
    }

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .insert({
          contact_id: input.contactId,
          phone_number: input.phoneNumber,
          correlation_id: input.correlationId,
          direction: input.direction,
          channel: input.channel,
          content: input.content,
          agent_id: input.agentId,
          model_used: input.modelUsed,
          tokens_used: input.tokensUsed,
          tool_calls: input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        })
        .select()
        .single();

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to store message");
        return null;
      }

      logEvent(this.logger, "message_stored", {
        messageId: data.id,
        direction: input.direction,
        phoneNumber: input.phoneNumber,
      });

      return this.rowToMessage(data as MessageRow);
    } catch (error) {
      logError(this.logger, error as Error, "Error storing message");
      return null;
    }
  }

  /**
   * Store an inbound message
   */
  async storeInboundMessage(
    phoneNumber: string,
    content: string,
    channel: Channel,
    correlationId: string,
    contactId?: string
  ): Promise<ConversationMessage | null> {
    return this.storeMessage({
      phoneNumber,
      content,
      channel,
      correlationId,
      contactId,
      direction: "inbound",
    });
  }

  /**
   * Store an outbound message
   */
  async storeOutboundMessage(
    phoneNumber: string,
    content: string,
    channel: Channel,
    correlationId: string,
    options?: {
      contactId?: string;
      agentId?: string;
      modelUsed?: string;
      tokensUsed?: number;
      toolCalls?: ToolCall[];
    }
  ): Promise<ConversationMessage | null> {
    return this.storeMessage({
      phoneNumber,
      content,
      channel,
      correlationId,
      direction: "outbound",
      ...options,
    });
  }

  /**
   * Get messages for a phone number
   */
  async getMessagesByPhone(
    phoneNumber: string,
    options?: {
      limit?: number;
      offset?: number;
      order?: "asc" | "desc";
    }
  ): Promise<ConversationMessage[]> {
    if (!this.client) {
      return [];
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const order = options?.order || "desc";

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select("*")
        .eq("phone_number", phoneNumber)
        .order("created_at", { ascending: order === "asc" })
        .range(offset, offset + limit - 1);

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to get messages");
        return [];
      }

      return (data as MessageRow[]).map(this.rowToMessage);
    } catch (error) {
      logError(this.logger, error as Error, "Error getting messages");
      return [];
    }
  }

  /**
   * Get messages for a contact ID
   */
  async getMessagesByContact(
    contactId: string,
    options?: {
      limit?: number;
      offset?: number;
      order?: "asc" | "desc";
    }
  ): Promise<ConversationMessage[]> {
    if (!this.client) {
      return [];
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const order = options?.order || "desc";

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: order === "asc" })
        .range(offset, offset + limit - 1);

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to get messages by contact");
        return [];
      }

      return (data as MessageRow[]).map(this.rowToMessage);
    } catch (error) {
      logError(this.logger, error as Error, "Error getting messages by contact");
      return [];
    }
  }

  /**
   * Get recent messages for context building
   */
  async getRecentMessages(
    phoneNumber: string,
    limit: number = 10
  ): Promise<ConversationMessage[]> {
    const messages = await this.getMessagesByPhone(phoneNumber, {
      limit,
      order: "desc",
    });

    // Return in chronological order for context
    return messages.reverse();
  }

  /**
   * Get messages by correlation ID
   */
  async getMessagesByCorrelation(correlationId: string): Promise<ConversationMessage[]> {
    if (!this.client) {
      return [];
    }

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select("*")
        .eq("correlation_id", correlationId)
        .order("created_at", { ascending: true });

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to get messages by correlation");
        return [];
      }

      return (data as MessageRow[]).map(this.rowToMessage);
    } catch (error) {
      logError(this.logger, error as Error, "Error getting messages by correlation");
      return [];
    }
  }

  /**
   * Count messages for a phone number
   */
  async countMessages(phoneNumber: string): Promise<number> {
    if (!this.client) {
      return 0;
    }

    try {
      const { count, error } = await this.client
        .from(this.tableName)
        .select("*", { count: "exact", head: true })
        .eq("phone_number", phoneNumber);

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to count messages");
        return 0;
      }

      return count || 0;
    } catch (error) {
      logError(this.logger, error as Error, "Error counting messages");
      return 0;
    }
  }

  /**
   * Delete old messages (for cleanup)
   */
  async deleteOldMessages(
    phoneNumber: string,
    keepCount: number = 100
  ): Promise<number> {
    if (!this.client) {
      return 0;
    }

    try {
      // Get messages to keep
      const { data: keepMessages } = await this.client
        .from(this.tableName)
        .select("id")
        .eq("phone_number", phoneNumber)
        .order("created_at", { ascending: false })
        .limit(keepCount);

      if (!keepMessages || keepMessages.length === 0) {
        return 0;
      }

      const keepIds = keepMessages.map((m) => m.id);

      // Delete messages not in keep list
      const { count, error } = await this.client
        .from(this.tableName)
        .delete({ count: "exact" })
        .eq("phone_number", phoneNumber)
        .not("id", "in", `(${keepIds.join(",")})`);

      if (error) {
        logError(this.logger, new Error(error.message), "Failed to delete old messages");
        return 0;
      }

      if (count && count > 0) {
        logEvent(this.logger, "old_messages_deleted", {
          phoneNumber,
          deletedCount: count,
        });
      }

      return count || 0;
    } catch (error) {
      logError(this.logger, error as Error, "Error deleting old messages");
      return 0;
    }
  }

  /**
   * Convert database row to ConversationMessage
   */
  private rowToMessage(row: MessageRow): ConversationMessage {
    let toolCalls: ToolCall[] | undefined;

    if (row.tool_calls) {
      try {
        toolCalls =
          typeof row.tool_calls === "string"
            ? JSON.parse(row.tool_calls)
            : (row.tool_calls as ToolCall[]);
      } catch {
        // Ignore parse errors
      }
    }

    return {
      id: row.id,
      contactId: row.contact_id || "",
      phoneNumber: row.phone_number,
      correlationId: row.correlation_id,
      direction: row.direction as MessageDirection,
      channel: row.channel as Channel,
      content: row.content,
      agentId: row.agent_id || undefined,
      modelUsed: row.model_used || undefined,
      tokensUsed: row.tokens_used || undefined,
      toolCalls,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Create in-memory message (when Supabase not configured)
   */
  private createInMemoryMessage(input: CreateMessageInput): ConversationMessage {
    return {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contactId: input.contactId || "",
      phoneNumber: input.phoneNumber,
      correlationId: input.correlationId,
      direction: input.direction,
      channel: input.channel,
      content: input.content,
      agentId: input.agentId,
      modelUsed: input.modelUsed,
      tokensUsed: input.tokensUsed,
      toolCalls: input.toolCalls,
      createdAt: new Date(),
    };
  }
}

// Singleton instance
let instance: MessageStore | null = null;

/**
 * Get or create the message store instance
 */
export function getMessageStore(config?: MessageStoreConfig): MessageStore {
  if (!instance) {
    instance = new MessageStore(config);
  }
  return instance;
}

/**
 * Reset the message store (for testing)
 */
export function resetMessageStore(): void {
  instance = null;
}
