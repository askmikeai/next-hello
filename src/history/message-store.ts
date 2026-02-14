import type { Sql } from "postgres";
import type { Logger } from "pino";
import { getDatabase, isDatabaseConfigured } from "../database/client.js";
import { createLogger, logEvent, logError } from "../observability/logger.js";
import type {
  ConversationMessage,
  MessageDirection,
  MessageType,
  Channel,
  ToolCall,
} from "../swarm/types.js";

/**
 * Message store configuration
 */
export interface MessageStoreConfig {
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
  message_type: string;
  content: string | null;
  agent_id: string | null;
  model_used: string | null;
  tokens_used: number | null;
  tool_calls: unknown | null;
  created_at: string;
  // Media fields
  media_url: string | null;
  media_mimetype: string | null;
  media_size_bytes: number | null;
  media_duration_seconds: number | null;
  media_width: number | null;
  media_height: number | null;
  // Location fields
  location_latitude: number | null;
  location_longitude: number | null;
  location_name: string | null;
  location_address: string | null;
  // Flags
  is_voice_note: boolean | null;
  is_video_note: boolean | null;
  is_gif: boolean | null;
  is_view_once: boolean | null;
  is_animated: boolean | null;
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
  messageType?: MessageType;
  content?: string;
  agentId?: string;
  modelUsed?: string;
  tokensUsed?: number;
  toolCalls?: ToolCall[];
  // Media fields
  mediaUrl?: string;
  mediaMimetype?: string;
  mediaSizeBytes?: number;
  mediaDurationSeconds?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  // Location fields
  locationLatitude?: number;
  locationLongitude?: number;
  locationName?: string;
  locationAddress?: string;
  // Flags
  isVoiceNote?: boolean;
  isVideoNote?: boolean;
  isGif?: boolean;
  isViewOnce?: boolean;
  isAnimated?: boolean;
}

const DEFAULT_TABLE = "message_history";

/**
 * MessageStore - Persists conversation messages to PostgreSQL
 */
export class MessageStore {
  private sql: Sql | null = null;
  private tableName: string;
  private logger: Logger;
  private configured: boolean = false;

  constructor(config?: MessageStoreConfig) {
    this.tableName = config?.tableName || DEFAULT_TABLE;
    this.logger = createLogger({ component: "message-store" });

    this.sql = getDatabase();
    this.configured = isDatabaseConfigured();

    if (this.configured) {
      logEvent(this.logger, "message_store_initialized", { tableName: this.tableName });
    } else {
      this.logger.warn("PostgreSQL not configured, message store will use in-memory fallback");
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
    if (!this.sql) {
      this.logger.debug("Message store not configured, skipping storage");
      return this.createInMemoryMessage(input);
    }

    try {
      const rows = await this.sql<MessageRow[]>`
        INSERT INTO ${this.sql(this.tableName)} (
          contact_id,
          phone_number,
          correlation_id,
          direction,
          channel,
          message_type,
          content,
          agent_id,
          model_used,
          tokens_used,
          tool_calls,
          media_url,
          media_mimetype,
          media_size_bytes,
          media_duration_seconds,
          media_width,
          media_height,
          location_latitude,
          location_longitude,
          location_name,
          location_address,
          is_voice_note,
          is_video_note,
          is_gif,
          is_view_once,
          is_animated
        ) VALUES (
          ${input.contactId || null},
          ${input.phoneNumber},
          ${input.correlationId},
          ${input.direction},
          ${input.channel},
          ${input.messageType || "text"},
          ${input.content || null},
          ${input.agentId || null},
          ${input.modelUsed || null},
          ${input.tokensUsed || null},
          ${input.toolCalls ? JSON.stringify(input.toolCalls) : null},
          ${input.mediaUrl || null},
          ${input.mediaMimetype || null},
          ${input.mediaSizeBytes || null},
          ${input.mediaDurationSeconds || null},
          ${input.mediaWidth || null},
          ${input.mediaHeight || null},
          ${input.locationLatitude || null},
          ${input.locationLongitude || null},
          ${input.locationName || null},
          ${input.locationAddress || null},
          ${input.isVoiceNote || false},
          ${input.isVideoNote || false},
          ${input.isGif || false},
          ${input.isViewOnce || false},
          ${input.isAnimated || false}
        )
        RETURNING *
      `;

      const data = rows[0];

      logEvent(this.logger, "message_stored", {
        messageId: data.id,
        direction: input.direction,
        messageType: input.messageType || "text",
        phoneNumber: input.phoneNumber,
      });

      return this.rowToMessage(data);
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
    if (!this.sql) {
      return [];
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const order = options?.order || "desc";

    try {
      let rows: MessageRow[];
      if (order === "asc") {
        rows = await this.sql<MessageRow[]>`
          SELECT * FROM ${this.sql(this.tableName)}
          WHERE phone_number = ${phoneNumber}
          ORDER BY created_at ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      } else {
        rows = await this.sql<MessageRow[]>`
          SELECT * FROM ${this.sql(this.tableName)}
          WHERE phone_number = ${phoneNumber}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      }

      return rows.map((row) => this.rowToMessage(row));
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
    if (!this.sql) {
      return [];
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const order = options?.order || "desc";

    try {
      let rows: MessageRow[];
      if (order === "asc") {
        rows = await this.sql<MessageRow[]>`
          SELECT * FROM ${this.sql(this.tableName)}
          WHERE contact_id = ${contactId}
          ORDER BY created_at ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      } else {
        rows = await this.sql<MessageRow[]>`
          SELECT * FROM ${this.sql(this.tableName)}
          WHERE contact_id = ${contactId}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      }

      return rows.map((row) => this.rowToMessage(row));
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
    if (!this.sql) {
      return [];
    }

    try {
      const rows = await this.sql<MessageRow[]>`
        SELECT * FROM ${this.sql(this.tableName)}
        WHERE correlation_id = ${correlationId}
        ORDER BY created_at ASC
      `;

      return rows.map((row) => this.rowToMessage(row));
    } catch (error) {
      logError(this.logger, error as Error, "Error getting messages by correlation");
      return [];
    }
  }

  /**
   * Count messages for a phone number
   */
  async countMessages(phoneNumber: string): Promise<number> {
    if (!this.sql) {
      return 0;
    }

    try {
      const result = await this.sql<[{ count: string }]>`
        SELECT COUNT(*) as count
        FROM ${this.sql(this.tableName)}
        WHERE phone_number = ${phoneNumber}
      `;

      return parseInt(result[0].count, 10) || 0;
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
    if (!this.sql) {
      return 0;
    }

    try {
      // Use the helper function we defined in the migration
      const result = await this.sql<[{ cleanup_old_messages: number }]>`
        SELECT cleanup_old_messages(${phoneNumber}, ${keepCount})
      `;

      const deletedCount = result[0]?.cleanup_old_messages || 0;

      if (deletedCount > 0) {
        logEvent(this.logger, "old_messages_deleted", {
          phoneNumber,
          deletedCount,
        });
      }

      return deletedCount;
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
      messageType: (row.message_type as MessageType) || "text",
      content: row.content || undefined,
      agentId: row.agent_id || undefined,
      modelUsed: row.model_used || undefined,
      tokensUsed: row.tokens_used || undefined,
      toolCalls,
      createdAt: new Date(row.created_at),
      // Media fields
      mediaUrl: row.media_url || undefined,
      mediaMimetype: row.media_mimetype || undefined,
      mediaSizeBytes: row.media_size_bytes || undefined,
      mediaDurationSeconds: row.media_duration_seconds || undefined,
      mediaWidth: row.media_width || undefined,
      mediaHeight: row.media_height || undefined,
      // Location fields
      locationLatitude: row.location_latitude || undefined,
      locationLongitude: row.location_longitude || undefined,
      locationName: row.location_name || undefined,
      locationAddress: row.location_address || undefined,
      // Flags
      isVoiceNote: row.is_voice_note || undefined,
      isVideoNote: row.is_video_note || undefined,
      isGif: row.is_gif || undefined,
      isViewOnce: row.is_view_once || undefined,
      isAnimated: row.is_animated || undefined,
    };
  }

  /**
   * Create in-memory message (when PostgreSQL not configured)
   */
  private createInMemoryMessage(input: CreateMessageInput): ConversationMessage {
    return {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contactId: input.contactId || "",
      phoneNumber: input.phoneNumber,
      correlationId: input.correlationId,
      direction: input.direction,
      channel: input.channel,
      messageType: input.messageType || "text",
      content: input.content,
      agentId: input.agentId,
      modelUsed: input.modelUsed,
      tokensUsed: input.tokensUsed,
      toolCalls: input.toolCalls,
      createdAt: new Date(),
      // Media fields
      mediaUrl: input.mediaUrl,
      mediaMimetype: input.mediaMimetype,
      mediaSizeBytes: input.mediaSizeBytes,
      mediaDurationSeconds: input.mediaDurationSeconds,
      mediaWidth: input.mediaWidth,
      mediaHeight: input.mediaHeight,
      // Location fields
      locationLatitude: input.locationLatitude,
      locationLongitude: input.locationLongitude,
      locationName: input.locationName,
      locationAddress: input.locationAddress,
      // Flags
      isVoiceNote: input.isVoiceNote,
      isVideoNote: input.isVideoNote,
      isGif: input.isGif,
      isViewOnce: input.isViewOnce,
      isAnimated: input.isAnimated,
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
