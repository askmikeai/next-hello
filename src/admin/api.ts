/**
 * Admin API Endpoints
 *
 * API functions for the admin dashboard.
 */

import { getDatabase } from "../database/client.js";
import { checkDatabaseHealth } from "../database/client.js";
import { checkRedisHealth, getQueueStats, addJob, getRedisConnection } from "../queue/client.js";
import { getActivityStore, type AgentActivityRecord } from "../observability/activity-store.js";
import { getMessageStore } from "../history/message-store.js";
import { getMediaStore } from "../storage/media-store.js";
import type { NetworkingContact, ContactStatus } from "../config/types.js";
import type { QueueName, ConversationMessage, AgentType, SwarmState } from "../swarm/types.js";

/** System phone number for non-contact media like greeting videos */
const SYSTEM_PHONE_NUMBER = "SYSTEM";
const GREETING_VIDEO_MEDIA_TYPE = "video" as const;

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
      firstName: contact.first_name || "there",
      scriptTemplate: "Hey {name}, it was great meeting you! I wanted to send you a quick personalized video to follow up on our conversation. Looking forward to connecting soon!",
      variables: {
        name: contact.first_name || "there",
        company: contact.company_name || "",
      },
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
 * Swarm state response for API
 */
export interface SwarmStateResponse {
  correlationId: string;
  phoneNumber: string;
  currentAgent: AgentType | null;
  conversationTurns: number;
  lastActivityAt: string;
  taskQueueLength: number;
  channel: string;
}

/**
 * Agent handoff data
 */
export interface HandoffData {
  fromAgent: AgentType;
  toAgent: AgentType;
  count: number;
}

/**
 * Agent performance statistics
 */
export interface AgentStatsData {
  agentType: AgentType;
  executions: number;
  avgDurationMs: number;
  successRate: number;
}

/**
 * Get active swarm states from Redis
 */
export async function getSwarmStates(): Promise<SwarmStateResponse[]> {
  const redis = getRedisConnection();
  if (!redis) {
    return [];
  }

  try {
    // Get all swarm state keys
    const keys = await redis.keys("swarm:state:*");
    if (keys.length === 0) {
      return [];
    }

    const states: SwarmStateResponse[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        try {
          const state: SwarmState = JSON.parse(data);
          states.push({
            correlationId: state.correlationId,
            phoneNumber: state.phoneNumber,
            currentAgent: state.currentAgent || null,
            conversationTurns: state.conversationTurns,
            lastActivityAt: state.lastActivityAt instanceof Date
              ? state.lastActivityAt.toISOString()
              : String(state.lastActivityAt),
            taskQueueLength: state.taskQueue?.length || 0,
            channel: state.channel,
          });
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Sort by last activity (most recent first)
    states.sort((a, b) =>
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );

    return states;
  } catch (error) {
    console.error("[admin] Error getting swarm states:", error);
    return [];
  }
}

/**
 * Get agent handoff statistics (last 24 hours)
 */
export async function getHandoffs(): Promise<HandoffData[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    const rows = await sql<{ from_agent: string; to_agent: string; count: string }[]>`
      WITH ordered AS (
        SELECT
          correlation_id,
          agent_type,
          started_at,
          LAG(agent_type) OVER (
            PARTITION BY correlation_id
            ORDER BY started_at
          ) as prev_agent
        FROM agent_activity_log
        WHERE started_at > NOW() - INTERVAL '24 hours'
      )
      SELECT
        prev_agent as from_agent,
        agent_type as to_agent,
        COUNT(*)::text as count
      FROM ordered
      WHERE prev_agent IS NOT NULL
        AND prev_agent != agent_type
      GROUP BY prev_agent, agent_type
      ORDER BY count DESC
    `;

    return rows.map(row => ({
      fromAgent: row.from_agent as AgentType,
      toAgent: row.to_agent as AgentType,
      count: parseInt(row.count, 10),
    }));
  } catch (error) {
    console.error("[admin] Error getting handoffs:", error);
    return [];
  }
}

/**
 * Get per-agent performance statistics (last 24 hours)
 */
export async function getAgentStats(): Promise<AgentStatsData[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    const rows = await sql<{
      agent_type: string;
      executions: string;
      avg_duration: string;
      success_rate: string;
    }[]>`
      SELECT
        agent_type,
        COUNT(*)::text as executions,
        COALESCE(AVG(duration_ms)::int, 0)::text as avg_duration,
        COALESCE(
          (SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::float /
           NULLIF(COUNT(*), 0) * 100),
          0
        )::text as success_rate
      FROM agent_activity_log
      WHERE started_at > NOW() - INTERVAL '24 hours'
      GROUP BY agent_type
      ORDER BY executions DESC
    `;

    return rows.map(row => ({
      agentType: row.agent_type as AgentType,
      executions: parseInt(row.executions, 10),
      avgDurationMs: parseInt(row.avg_duration, 10),
      successRate: parseFloat(row.success_rate),
    }));
  } catch (error) {
    console.error("[admin] Error getting agent stats:", error);
    return [];
  }
}

/**
 * Get detailed swarm conversation by correlation ID
 */
export async function getSwarmConversation(correlationId: string): Promise<{
  state: SwarmStateResponse | null;
  activities: AgentActivityRecord[];
  messages: ConversationMessage[];
}> {
  const redis = getRedisConnection();
  let state: SwarmStateResponse | null = null;

  // Try to get current state from Redis
  if (redis) {
    try {
      const data = await redis.get(`swarm:state:${correlationId}`);
      if (data) {
        const parsed: SwarmState = JSON.parse(data);
        state = {
          correlationId: parsed.correlationId,
          phoneNumber: parsed.phoneNumber,
          currentAgent: parsed.currentAgent || null,
          conversationTurns: parsed.conversationTurns,
          lastActivityAt: parsed.lastActivityAt instanceof Date
            ? parsed.lastActivityAt.toISOString()
            : String(parsed.lastActivityAt),
          taskQueueLength: parsed.taskQueue?.length || 0,
          channel: parsed.channel,
        };
      }
    } catch {
      // Ignore Redis errors
    }
  }

  // Get activities for this correlation ID
  const store = getActivityStore();
  const allActivities = await store.getRecentActivities(undefined, 100);
  const activities = allActivities.filter(a => a.correlationId === correlationId);

  // Get messages for this correlation ID
  const sql = getDatabase();
  let messages: ConversationMessage[] = [];

  if (sql) {
    try {
      const rows = await sql`
        SELECT * FROM message_history
        WHERE correlation_id = ${correlationId}
        ORDER BY created_at ASC
        LIMIT 100
      `;

      messages = rows.map((row) => ({
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
      })) as ConversationMessage[];
    } catch {
      // Ignore DB errors
    }
  }

  return { state, activities, messages };
}

/**
 * Greeting video response
 */
export interface GreetingVideoResponse {
  exists: boolean;
  storageKey?: string;
  filename?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  url?: string;
}

/**
 * Get current greeting video info
 */
export async function getGreetingVideo(): Promise<GreetingVideoResponse> {
  const sql = getDatabase();
  if (!sql) {
    return { exists: false };
  }

  try {
    // Look for the most recent greeting video
    const rows = await sql<{
      storage_key: string;
      size_bytes: string;
      created_at: Date;
      mime_type: string;
    }[]>`
      SELECT storage_key, size_bytes, created_at, mime_type
      FROM media_files
      WHERE phone_number = ${SYSTEM_PHONE_NUMBER}
        AND media_type = ${GREETING_VIDEO_MEDIA_TYPE}
        AND source = 'uploaded'
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return { exists: false };
    }

    const row = rows[0];

    // Extract filename from storage key
    const filename = row.storage_key.split("/").pop() || "greeting-video.mp4";

    // Use admin media endpoint for serving the video
    const url = `/admin/media/${row.storage_key}`;

    return {
      exists: true,
      storageKey: row.storage_key,
      filename,
      sizeBytes: parseInt(row.size_bytes, 10),
      uploadedAt: row.created_at.toISOString(),
      url,
    };
  } catch (error) {
    console.error("[admin] Error getting greeting video:", error);
    return { exists: false };
  }
}

/**
 * Store greeting video
 */
export async function storeGreetingVideo(
  data: Buffer,
  mimeType: string,
  filename?: string
): Promise<{ success: boolean; storageKey?: string; error?: string }> {
  const mediaStore = getMediaStore();

  // Delete any existing greeting videos first
  await deleteGreetingVideoInternal();

  const result = await mediaStore.store({
    phoneNumber: SYSTEM_PHONE_NUMBER,
    mediaType: GREETING_VIDEO_MEDIA_TYPE,
    data,
    mimeType,
    source: "uploaded",
    retentionPolicy: "permanent",
    filename,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  console.log(`[admin] Stored greeting video: ${result.storageKey}`);
  return { success: true, storageKey: result.storageKey };
}

/**
 * Delete greeting video (internal)
 */
async function deleteGreetingVideoInternal(): Promise<void> {
  const sql = getDatabase();
  if (!sql) return;

  try {
    // Soft delete any existing greeting videos
    await sql`
      UPDATE media_files
      SET deleted_at = NOW()
      WHERE phone_number = ${SYSTEM_PHONE_NUMBER}
        AND media_type = ${GREETING_VIDEO_MEDIA_TYPE}
        AND source = 'uploaded'
        AND deleted_at IS NULL
    `;
  } catch (error) {
    console.error("[admin] Error deleting greeting video:", error);
  }
}

/**
 * Delete greeting video (public API)
 */
export async function deleteGreetingVideo(): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteGreetingVideoInternal();
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  }
}

// ============================================================================
// Contact Detail API Functions
// ============================================================================

/**
 * PDL Person Enrichment data structure
 */
export interface PDLEnrichment {
  id: string;
  contactId: string;
  pdlId: string | null;
  likelihood: number | null;
  matchedOn: string[] | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  workEmail: string | null;
  personalEmails: string[] | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  jobTitleRole: string | null;
  jobTitleLevels: string[] | null;
  jobStartDate: string | null;
  inferredSalary: string | null;
  inferredYearsExperience: number | null;
  jobCompanyName: string | null;
  jobCompanyWebsite: string | null;
  jobCompanyLinkedinUrl: string | null;
  jobCompanySize: string | null;
  jobCompanyIndustry: string | null;
  jobCompanyType: string | null;
  jobCompanyEmployeeCount: number | null;
  jobCompanyInferredRevenue: string | null;
  locationName: string | null;
  locationLocality: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  linkedinUrl: string | null;
  linkedinId: string | null;
  linkedinUsername: string | null;
  linkedinConnections: number | null;
  twitterUrl: string | null;
  twitterUsername: string | null;
  githubUrl: string | null;
  githubUsername: string | null;
  facebookUrl: string | null;
  experience: unknown[] | null;
  education: unknown[] | null;
  skills: string[] | null;
  interests: string[] | null;
  enrichedAt: string | null;
}

/**
 * Get PDL enrichment data for a contact
 */
export async function getContactEnrichment(contactId: string): Promise<PDLEnrichment | null> {
  const sql = getDatabase();
  if (!sql) {
    return null;
  }

  try {
    const rows = await sql`
      SELECT * FROM pdl_person_enrichment
      WHERE contact_id = ${contactId}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      contactId: row.contact_id,
      pdlId: row.pdl_id,
      likelihood: row.likelihood,
      matchedOn: row.matched_on,
      fullName: row.full_name,
      firstName: row.first_name,
      lastName: row.last_name,
      workEmail: row.work_email,
      personalEmails: row.personal_emails,
      mobilePhone: row.mobile_phone,
      jobTitle: row.job_title,
      jobTitleRole: row.job_title_role,
      jobTitleLevels: row.job_title_levels,
      jobStartDate: row.job_start_date ? new Date(row.job_start_date).toISOString() : null,
      inferredSalary: row.inferred_salary,
      inferredYearsExperience: row.inferred_years_experience,
      jobCompanyName: row.job_company_name,
      jobCompanyWebsite: row.job_company_website,
      jobCompanyLinkedinUrl: row.job_company_linkedin_url,
      jobCompanySize: row.job_company_size,
      jobCompanyIndustry: row.job_company_industry,
      jobCompanyType: row.job_company_type,
      jobCompanyEmployeeCount: row.job_company_employee_count,
      jobCompanyInferredRevenue: row.job_company_inferred_revenue,
      locationName: row.location_name,
      locationLocality: row.location_locality,
      locationRegion: row.location_region,
      locationCountry: row.location_country,
      linkedinUrl: row.linkedin_url,
      linkedinId: row.linkedin_id,
      linkedinUsername: row.linkedin_username,
      linkedinConnections: row.linkedin_connections,
      twitterUrl: row.twitter_url,
      twitterUsername: row.twitter_username,
      githubUrl: row.github_url,
      githubUsername: row.github_username,
      facebookUrl: row.facebook_url,
      experience: row.experience,
      education: row.education,
      skills: row.skills,
      interests: row.interests,
      enrichedAt: row.enriched_at ? new Date(row.enriched_at).toISOString() : null,
    };
  } catch (error) {
    console.error("[admin] Error getting contact enrichment:", error);
    return null;
  }
}

/**
 * Luma guest data structure
 */
export interface LumaGuest {
  id: string;
  lumaUserId: string | null;
  lumaProfileUrl: string;
  name: string;
  bio: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  twitterHandle: string | null;
}

/**
 * Luma event data structure
 */
export interface LumaEvent {
  id: string;
  slug: string;
  name: string;
  url: string;
  eventDate: string | null;
  location: string | null;
  isOnline: boolean;
  hostName: string | null;
  guestCount: number;
  isFeatured: boolean;
  isHost: boolean;
}

/**
 * Luma associations response
 */
export interface LumaAssociationsResponse {
  guest: LumaGuest | null;
  events: LumaEvent[];
}

/**
 * Get Luma guest and events for a contact
 */
export async function getContactLumaAssociations(contactId: string): Promise<LumaAssociationsResponse> {
  const sql = getDatabase();
  if (!sql) {
    return { guest: null, events: [] };
  }

  try {
    // Get the associated guest
    const guestRows = await sql`
      SELECT g.* FROM luma_guests g
      JOIN contact_luma_associations cla ON g.id = cla.guest_id
      WHERE cla.contact_id = ${contactId}
      LIMIT 1
    `;

    let guest: LumaGuest | null = null;
    if (guestRows.length > 0) {
      const row = guestRows[0];
      guest = {
        id: row.id,
        lumaUserId: row.luma_user_id,
        lumaProfileUrl: row.luma_profile_url,
        name: row.name,
        bio: row.bio,
        instagramUrl: row.instagram_url,
        twitterUrl: row.twitter_url,
        linkedinUrl: row.linkedin_url,
        websiteUrl: row.website_url,
        instagramHandle: row.instagram_handle,
        twitterHandle: row.twitter_handle,
      };
    }

    // Get events the guest attended
    const eventRows = await sql`
      SELECT e.*, eg.is_featured, eg.is_host
      FROM luma_events e
      JOIN luma_event_guests eg ON e.id = eg.event_id
      JOIN contact_luma_associations cla ON eg.guest_id = cla.guest_id
      WHERE cla.contact_id = ${contactId}
      ORDER BY e.event_date DESC
      LIMIT 20
    `;

    const events: LumaEvent[] = eventRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      url: row.url,
      eventDate: row.event_date ? new Date(row.event_date).toISOString() : null,
      location: row.location,
      isOnline: row.is_online,
      hostName: row.host_name,
      guestCount: row.guest_count || 0,
      isFeatured: row.is_featured || false,
      isHost: row.is_host || false,
    }));

    return { guest, events };
  } catch (error) {
    console.error("[admin] Error getting contact Luma associations:", error);
    return { guest: null, events: [] };
  }
}

/**
 * Media file data structure
 */
export interface MediaFileResponse {
  id: string;
  storageKey: string;
  mediaType: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  createdAt: string;
  url: string;
}

/**
 * Get media files for a contact
 */
export async function getContactMedia(contactId: string): Promise<MediaFileResponse[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    // First get the contact's phone number
    const contactRows = await sql`
      SELECT phone_number FROM networking_contacts
      WHERE id = ${contactId}
    `;

    if (contactRows.length === 0 || !contactRows[0].phone_number) {
      return [];
    }

    const phoneNumber = contactRows[0].phone_number;

    const rows = await sql`
      SELECT id, storage_key, media_type, mime_type, size_bytes, source, created_at
      FROM media_files
      WHERE phone_number = ${phoneNumber}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return rows.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      sizeBytes: parseInt(row.size_bytes, 10),
      source: row.source,
      createdAt: new Date(row.created_at).toISOString(),
      url: `/admin/media/${row.storage_key}`,
    }));
  } catch (error) {
    console.error("[admin] Error getting contact media:", error);
    return [];
  }
}

/**
 * Get agent activities for a specific contact
 */
export async function getContactActivities(contactId: string): Promise<AgentActivityRecord[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  try {
    // First get the contact's phone number to find correlation IDs
    const contactRows = await sql`
      SELECT phone_number FROM networking_contacts
      WHERE id = ${contactId}
    `;

    if (contactRows.length === 0 || !contactRows[0].phone_number) {
      return [];
    }

    const phoneNumber = contactRows[0].phone_number;

    // Get activities by finding correlation IDs from message history
    const rows = await sql`
      SELECT DISTINCT a.*
      FROM agent_activity_log a
      WHERE a.correlation_id IN (
        SELECT DISTINCT correlation_id
        FROM message_history
        WHERE phone_number = ${phoneNumber}
      )
      ORDER BY a.started_at DESC
      LIMIT 50
    `;

    return rows.map((row) => ({
      id: row.id,
      correlationId: row.correlation_id,
      agentType: row.agent_type,
      action: row.action,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      durationMs: row.duration_ms,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      toolName: row.tool_name,
      metadata: row.metadata,
    })) as AgentActivityRecord[];
  } catch (error) {
    console.error("[admin] Error getting contact activities:", error);
    return [];
  }
}
