import type { Sql } from "postgres";
import { getDatabase, isDatabaseConfigured } from "../database/client.js";
import { createLogger, logEvent, logError } from "./logger.js";
import type { AgentType } from "../swarm/types.js";

/**
 * Agent activity record for database
 */
export interface AgentActivityRecord {
  id: string;
  correlationId: string;
  contactId?: string;
  agentType: AgentType;
  action: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  status: "started" | "completed" | "failed";
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

/**
 * Input for creating an activity record
 */
export interface CreateActivityInput {
  correlationId: string;
  contactId?: string;
  agentType: AgentType;
  action: string;
}

/**
 * Input for completing an activity record
 */
export interface CompleteActivityInput {
  status: "completed" | "failed";
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

const logger = createLogger({ component: "activity-store" });

/**
 * ActivityStore - Persists agent activity to PostgreSQL
 */
export class ActivityStore {
  private sql: Sql | null = null;
  private configured: boolean = false;

  constructor() {
    this.sql = getDatabase();
    this.configured = isDatabaseConfigured();

    if (this.configured) {
      logEvent(logger, "activity_store_initialized");
    } else {
      logger.warn("PostgreSQL not configured, activity store disabled");
    }
  }

  /**
   * Start tracking an agent activity
   */
  async startActivity(input: CreateActivityInput): Promise<string | null> {
    if (!this.sql) {
      return null;
    }

    try {
      const rows = await this.sql<[{ id: string }]>`
        INSERT INTO agent_activity_log (
          correlation_id,
          contact_id,
          agent_type,
          action,
          started_at,
          status
        ) VALUES (
          ${input.correlationId},
          ${input.contactId || null},
          ${input.agentType},
          ${input.action},
          NOW(),
          'started'
        )
        RETURNING id
      `;

      const activityId = rows[0].id;

      logEvent(logger, "activity_started", {
        activityId,
        agentType: input.agentType,
        action: input.action,
      });

      return activityId;
    } catch (error) {
      logError(logger, error as Error, "Error starting activity");
      return null;
    }
  }

  /**
   * Complete an agent activity
   */
  async completeActivity(
    activityId: string,
    input: CompleteActivityInput
  ): Promise<boolean> {
    if (!this.sql) {
      return false;
    }

    try {
      await this.sql`
        UPDATE agent_activity_log
        SET
          completed_at = NOW(),
          status = ${input.status},
          duration_ms = ${input.durationMs || null},
          input_tokens = ${input.inputTokens || null},
          output_tokens = ${input.outputTokens || null},
          error_message = ${input.errorMessage || null}
        WHERE id = ${activityId}
      `;

      logEvent(logger, "activity_completed", {
        activityId,
        status: input.status,
        durationMs: input.durationMs,
      });

      return true;
    } catch (error) {
      logError(logger, error as Error, "Error completing activity");
      return false;
    }
  }

  /**
   * Log a complete activity in one call (start + complete)
   */
  async logActivity(
    input: CreateActivityInput & CompleteActivityInput & { durationMs: number }
  ): Promise<string | null> {
    if (!this.sql) {
      return null;
    }

    try {
      const rows = await this.sql<[{ id: string }]>`
        INSERT INTO agent_activity_log (
          correlation_id,
          contact_id,
          agent_type,
          action,
          started_at,
          completed_at,
          duration_ms,
          status,
          input_tokens,
          output_tokens,
          error_message
        ) VALUES (
          ${input.correlationId},
          ${input.contactId || null},
          ${input.agentType},
          ${input.action},
          NOW() - INTERVAL '1 millisecond' * ${input.durationMs},
          NOW(),
          ${input.durationMs},
          ${input.status},
          ${input.inputTokens || null},
          ${input.outputTokens || null},
          ${input.errorMessage || null}
        )
        RETURNING id
      `;

      const activityId = rows[0].id;

      logEvent(logger, "activity_logged", {
        activityId,
        agentType: input.agentType,
        action: input.action,
        status: input.status,
        durationMs: input.durationMs,
      });

      return activityId;
    } catch (error) {
      logError(logger, error as Error, "Error logging activity");
      return null;
    }
  }

  /**
   * Get activities by correlation ID
   */
  async getActivitiesByCorrelation(
    correlationId: string
  ): Promise<AgentActivityRecord[]> {
    if (!this.sql) {
      return [];
    }

    try {
      const rows = await this.sql<AgentActivityRecord[]>`
        SELECT
          id,
          correlation_id as "correlationId",
          contact_id as "contactId",
          agent_type as "agentType",
          action,
          started_at as "startedAt",
          completed_at as "completedAt",
          duration_ms as "durationMs",
          status,
          input_tokens as "inputTokens",
          output_tokens as "outputTokens",
          error_message as "errorMessage"
        FROM agent_activity_log
        WHERE correlation_id = ${correlationId}
        ORDER BY started_at ASC
      `;

      return rows;
    } catch (error) {
      logError(logger, error as Error, "Error getting activities");
      return [];
    }
  }

  /**
   * Get recent activities by agent type
   */
  async getRecentActivities(
    agentType?: AgentType,
    limit: number = 50
  ): Promise<AgentActivityRecord[]> {
    if (!this.sql) {
      return [];
    }

    try {
      let rows: AgentActivityRecord[];

      if (agentType) {
        rows = await this.sql<AgentActivityRecord[]>`
          SELECT
            id,
            correlation_id as "correlationId",
            contact_id as "contactId",
            agent_type as "agentType",
            action,
            started_at as "startedAt",
            completed_at as "completedAt",
            duration_ms as "durationMs",
            status,
            input_tokens as "inputTokens",
            output_tokens as "outputTokens",
            error_message as "errorMessage"
          FROM agent_activity_log
          WHERE agent_type = ${agentType}
          ORDER BY started_at DESC
          LIMIT ${limit}
        `;
      } else {
        rows = await this.sql<AgentActivityRecord[]>`
          SELECT
            id,
            correlation_id as "correlationId",
            contact_id as "contactId",
            agent_type as "agentType",
            action,
            started_at as "startedAt",
            completed_at as "completedAt",
            duration_ms as "durationMs",
            status,
            input_tokens as "inputTokens",
            output_tokens as "outputTokens",
            error_message as "errorMessage"
          FROM agent_activity_log
          ORDER BY started_at DESC
          LIMIT ${limit}
        `;
      }

      return rows;
    } catch (error) {
      logError(logger, error as Error, "Error getting recent activities");
      return [];
    }
  }
}

// Singleton instance
let instance: ActivityStore | null = null;

/**
 * Get or create the activity store instance
 */
export function getActivityStore(): ActivityStore {
  if (!instance) {
    instance = new ActivityStore();
  }
  return instance;
}

/**
 * Reset the activity store (for testing)
 */
export function resetActivityStore(): void {
  instance = null;
}
