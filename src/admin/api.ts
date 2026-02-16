/**
 * Admin API Endpoints
 *
 * API functions for the admin dashboard.
 */

import { getDatabase } from "../database/client.js";
import { checkDatabaseHealth } from "../database/client.js";
import { checkRedisHealth, getQueueStats, addJob } from "../queue/client.js";
import { getActivityStore, type AgentActivityRecord } from "../observability/activity-store.js";
import { getMessageStore } from "../history/message-store.js";
import type { NetworkingContact, ContactStatus } from "../config/types.js";
import type { QueueName, ConversationMessage } from "../swarm/types.js";

/**
 * All queue names for iteration
 */
const ALL_QUEUES: QueueName[] = [
  "incoming-messages",
  "outbound-messages",
  "agent-tasks",
  "research-jobs",
  "video-generation",
  "voice-generation",
  "crm-sync",
  "lead-qualification",
];

/**
 * Contact statistics response
 */
export interface ContactStats {
  total: number;
  byStatus: Record<string, number>;
  byQualification: Record<string, number>;
}

/**
 * Queue statistics response
 */
export interface QueueStatsResponse {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  redis: {
    connected: boolean;
    latencyMs: number;
    error?: string;
  };
  postgres: {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  };
}

/**
 * Get contact statistics
 */
export async function getStats(): Promise<ContactStats> {
  const sql = getDatabase();
  if (!sql) {
    return {
      total: 0,
      byStatus: {},
      byQualification: {},
    };
  }

  try {
    // Get total count and status breakdown
    const statusRows = await sql<{ status: string; count: string }[]>`
      SELECT COALESCE(status, 'unknown') as status, COUNT(*)::text as count
      FROM networking_contacts
      GROUP BY status
    `;

    const qualRows = await sql<{ tier: string; count: string }[]>`
      SELECT COALESCE(qualification_tier, 'unqualified') as tier, COUNT(*)::text as count
      FROM networking_contacts
      GROUP BY qualification_tier
    `;

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusRows) {
      byStatus[row.status] = parseInt(row.count, 10);
      total += parseInt(row.count, 10);
    }

    const byQualification: Record<string, number> = {};
    for (const row of qualRows) {
      byQualification[row.tier] = parseInt(row.count, 10);
    }

    return { total, byStatus, byQualification };
  } catch (error) {
    console.error("[admin] Error getting stats:", error);
    return {
      total: 0,
      byStatus: {},
      byQualification: {},
    };
  }
}

/**
 * Get contacts list
 */
export async function getContacts(
  limit = 50,
  status?: ContactStatus
): Promise<NetworkingContact[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    if (status) {
      const rows = await sql<NetworkingContact[]>`
        SELECT *
        FROM networking_contacts
        WHERE status = ${status}
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT ${limit}
      `;
      return rows;
    }

    const rows = await sql<NetworkingContact[]>`
      SELECT *
      FROM networking_contacts
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `;
    return rows;
  } catch (error) {
    console.error("[admin] Error getting contacts:", error);
    return [];
  }
}

/**
 * Get contact by ID
 */
export async function getContactById(id: string): Promise<NetworkingContact | null> {
  const sql = getDatabase();
  if (!sql) {
    return null;
  }

  try {
    const rows = await sql<NetworkingContact[]>`
      SELECT * FROM networking_contacts
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    console.error("[admin] Error getting contact:", error);
    return null;
  }
}

/**
 * Get recent agent activities
 */
export async function getActivities(
  limit = 20,
  agentType?: string
): Promise<AgentActivityRecord[]> {
  const store = getActivityStore();
  return store.getRecentActivities(agentType as AgentActivityRecord["agentType"], limit);
}

/**
 * Get recent messages across all contacts
 */
export async function getMessages(limit = 50): Promise<ConversationMessage[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    const rows = await sql`
      SELECT
        mh.*,
        nc.first_name,
        nc.last_name
      FROM message_history mh
      LEFT JOIN networking_contacts nc ON mh.contact_id = nc.id
      ORDER BY mh.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      contactId: row.contact_id || "",
      phoneNumber: row.phone_number,
      correlationId: row.correlation_id,
      direction: row.direction,
      channel: row.channel,
      messageType: row.message_type || "text",
      content: row.content || undefined,
      agentId: row.agent_id || undefined,
      createdAt: new Date(row.created_at),
      contactName: row.first_name ? `${row.first_name} ${row.last_name || ""}`.trim() : undefined,
    })) as ConversationMessage[];
  } catch (error) {
    console.error("[admin] Error getting messages:", error);
    return [];
  }
}

/**
 * Get messages for a specific contact
 */
export async function getMessagesForContact(
  contactId: string,
  limit = 50
): Promise<ConversationMessage[]> {
  const store = getMessageStore();
  return store.getMessagesByContact(contactId, { limit, order: "desc" });
}

/**
 * Get messages for a specific phone number
 */
export async function getMessagesByPhone(
  phoneNumber: string,
  limit = 50
): Promise<ConversationMessage[]> {
  const store = getMessageStore();
  return store.getMessagesByPhone(phoneNumber, { limit, order: "desc" });
}

/**
 * Get all queue statistics
 */
export async function getQueues(): Promise<QueueStatsResponse[]> {
  const results: QueueStatsResponse[] = [];

  for (const name of ALL_QUEUES) {
    const stats = await getQueueStats(name);
    results.push({
      name,
      ...stats,
    });
  }

  return results;
}

/**
 * Get health status
 */
export async function getHealth(): Promise<HealthResponse> {
  const [redisResult, dbResult] = await Promise.all([
    checkRedisHealth(),
    checkDatabaseHealth(),
  ]);

  return {
    redis: {
      connected: redisResult.connected,
      latencyMs: redisResult.latencyMs,
      error: redisResult.error,
    },
    postgres: {
      healthy: dbResult.healthy,
      latencyMs: dbResult.latencyMs,
      error: dbResult.error,
    },
  };
}

/**
 * Send voice message to contact
 */
export async function sendVoice(
  contactId: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const contact = await getContactById(contactId);
  if (!contact) {
    return { success: false, error: "Contact not found" };
  }

  if (!contact.phone_number) {
    return { success: false, error: "Contact has no phone number" };
  }

  try {
    const job = await addJob("voice-generation", {
      correlationId: `admin-voice-${Date.now()}`,
      contactId,
      phoneNumber: contact.phone_number,
      firstName: contact.first_name,
      lastName: contact.last_name,
      companyName: contact.company_name,
    });

    if (!job) {
      return { success: false, error: "Failed to queue job - Redis unavailable" };
    }

    return { success: true, jobId: job.id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

/**
 * Send video to contact
 */
export async function sendVideo(
  contactId: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const contact = await getContactById(contactId);
  if (!contact) {
    return { success: false, error: "Contact not found" };
  }

  if (!contact.phone_number) {
    return { success: false, error: "Contact has no phone number" };
  }

  try {
    const job = await addJob("video-generation", {
      correlationId: `admin-video-${Date.now()}`,
      contactId,
      phoneNumber: contact.phone_number,
      firstName: contact.first_name,
      lastName: contact.last_name,
      companyName: contact.company_name,
    });

    if (!job) {
      return { success: false, error: "Failed to queue job - Redis unavailable" };
    }

    return { success: true, jobId: job.id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}
