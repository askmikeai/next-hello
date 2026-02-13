import { getDatabase, timedQuery } from "../database/client.js";
import type { ContactStatus, NetworkingContact } from "../config/types.js";
import { contactsCreatedTotal } from "../observability/metrics.js";

/**
 * Repository configuration (for backwards compatibility)
 */
export interface RepoConfig {
  tableName?: string;
}

const DEFAULT_TABLE = "networking_contacts";

function getTableName(config?: RepoConfig): string {
  return config?.tableName ?? process.env.CONTACTS_TABLE ?? DEFAULT_TABLE;
}

/**
 * Get the database client (for direct access when needed)
 */
export function getDatabaseClient() {
  return getDatabase();
}

/**
 * Reset client (for testing)
 */
export function resetDatabaseClient(): void {
  // Import and use resetDatabase from client module if needed
}

/**
 * Find contact by phone number
 */
export async function findContactByPhone(
  phoneNumber: string,
  config?: RepoConfig
): Promise<NetworkingContact | null> {
  const sql = getDatabase();
  if (!sql) {
    return null;
  }

  const table = getTableName(config);
  return timedQuery("select", "contacts", async () => {
    const rows = await sql<NetworkingContact[]>`
      SELECT * FROM ${sql(table)}
      WHERE phone_number = ${phoneNumber}
      LIMIT 1
    `;
    return rows[0] ?? null;
  });
}

/**
 * Find contact by email
 */
export async function findContactByEmail(
  email: string,
  config?: RepoConfig
): Promise<NetworkingContact | null> {
  const sql = getDatabase();
  if (!sql) {
    return null;
  }

  const table = getTableName(config);
  return timedQuery("select", "contacts", async () => {
    const rows = await sql<NetworkingContact[]>`
      SELECT * FROM ${sql(table)}
      WHERE email = ${email}
      LIMIT 1
    `;
    return rows[0] ?? null;
  });
}

/**
 * Find contact by CRM ID
 */
export async function findContactByCrmId(
  crmContactId: string,
  config?: RepoConfig
): Promise<NetworkingContact | null> {
  const sql = getDatabase();
  if (!sql) {
    return null;
  }

  const table = getTableName(config);
  const rows = await sql<NetworkingContact[]>`
    SELECT * FROM ${sql(table)}
    WHERE crm_contact_id = ${crmContactId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

/**
 * Create new contact
 */
export async function createContact(
  contact: Partial<NetworkingContact>,
  config?: RepoConfig
): Promise<NetworkingContact> {
  const sql = getDatabase();

  const now = new Date().toISOString();
  const insertData = {
    ...contact,
    status: contact.status ?? "new",
    created_at: now,
    updated_at: now,
  };

  // If database not configured, return mock contact for demo mode
  if (!sql) {
    console.log("[postgres] Demo mode: Database not configured, using in-memory contact");
    return {
      id: crypto.randomUUID(),
      ...insertData,
    } as NetworkingContact;
  }

  const table = getTableName(config);

  return timedQuery("insert", "contacts", async () => {
    // Build dynamic insert
    const keys = Object.keys(insertData) as (keyof typeof insertData)[];

    const rows = await sql<NetworkingContact[]>`
      INSERT INTO ${sql(table)} ${sql(insertData as Record<string, unknown>, ...keys)}
      RETURNING *
    `;

    // Increment contacts created metric
    const channel = contact.channel ?? "unknown";
    contactsCreatedTotal.inc({ channel });
    console.log(`[metrics] Contact created, incremented nexthello_contacts_created_total{channel="${channel}"}`);

    return rows[0];
  });
}

/**
 * Update contact by phone number
 */
export async function updateContactByPhone(
  phoneNumber: string,
  updates: Partial<NetworkingContact>,
  config?: RepoConfig
): Promise<NetworkingContact> {
  const sql = getDatabase();

  // If database not configured, return mock updated contact for demo mode
  if (!sql) {
    console.log(`[postgres] Demo mode: Would update ${phoneNumber} with`, Object.keys(updates));
    return {
      id: crypto.randomUUID(),
      phone_number: phoneNumber,
      ...updates,
      updated_at: new Date().toISOString(),
    } as NetworkingContact;
  }

  const table = getTableName(config);
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  return timedQuery("update", "contacts", async () => {
    const keys = Object.keys(updateData) as (keyof typeof updateData)[];

    const rows = await sql<NetworkingContact[]>`
      UPDATE ${sql(table)}
      SET ${sql(updateData as Record<string, unknown>, ...keys)}
      WHERE phone_number = ${phoneNumber}
      RETURNING *
    `;

    if (rows.length === 0) {
      throw new Error(`Contact not found: ${phoneNumber}`);
    }

    return rows[0];
  });
}

/**
 * Update contact by ID
 */
export async function updateContactById(
  id: string,
  updates: Partial<NetworkingContact>,
  config?: RepoConfig
): Promise<NetworkingContact> {
  const sql = getDatabase();

  // If database not configured, return mock updated contact for demo mode
  if (!sql) {
    console.log(`[postgres] Demo mode: Would update contact ${id} with`, Object.keys(updates));
    return {
      id,
      ...updates,
      updated_at: new Date().toISOString(),
    } as NetworkingContact;
  }

  const table = getTableName(config);
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const keys = Object.keys(updateData) as (keyof typeof updateData)[];

  const rows = await sql<NetworkingContact[]>`
    UPDATE ${sql(table)}
    SET ${sql(updateData as Record<string, unknown>, ...keys)}
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new Error(`Contact not found: ${id}`);
  }

  return rows[0];
}

/**
 * Update contact status
 */
export async function updateContactStatus(
  phoneNumber: string,
  status: ContactStatus,
  config?: RepoConfig
): Promise<NetworkingContact> {
  return updateContactByPhone(phoneNumber, { status }, config);
}

/**
 * Update HeyGen video info
 */
export async function updateHeyGenVideo(
  phoneNumber: string,
  videoId: string,
  videoUrl: string | null,
  config?: RepoConfig
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      heygen_video_id: videoId,
      heygen_video_url: videoUrl,
    },
    config
  );
}

/**
 * Update Calendly booking info
 */
export async function updateCalendlyBooking(
  phoneNumber: string,
  eventUri: string,
  scheduledAt: string,
  config?: RepoConfig
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      calendly_event_uri: eventUri,
      calendly_scheduled_at: scheduledAt,
      status: "meeting_scheduled",
    },
    config
  );
}

/**
 * Update CRM sync info
 */
export async function updateCrmSync(
  phoneNumber: string,
  crmContactId: string,
  config?: RepoConfig
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      crm_contact_id: crmContactId,
      crm_synced_at: new Date().toISOString(),
      status: "synced",
    },
    config
  );
}

/**
 * Mark personalized message as sent
 */
export async function markMessageSent(
  phoneNumber: string,
  config?: RepoConfig
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      sent_personalized_message: true,
      last_contact_date: new Date().toISOString().split("T")[0],
    },
    config
  );
}

/**
 * Delete contact by phone number (GDPR compliance)
 */
export async function deleteContactByPhone(
  phoneNumber: string,
  config?: RepoConfig
): Promise<{ success: boolean; error?: string }> {
  const sql = getDatabase();

  if (!sql) {
    console.log(`[postgres] Demo mode: Would delete contact ${phoneNumber}`);
    return { success: true };
  }

  const table = getTableName(config);

  try {
    await sql`
      DELETE FROM ${sql(table)}
      WHERE phone_number = ${phoneNumber}
    `;

    console.log(`[postgres] Deleted contact: ${phoneNumber}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Get contacts by status
 */
export async function getContactsByStatus(
  status: ContactStatus,
  config?: RepoConfig,
  limit = 100
): Promise<NetworkingContact[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  const table = getTableName(config);

  const rows = await sql<NetworkingContact[]>`
    SELECT * FROM ${sql(table)}
    WHERE status = ${status}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Get contacts needing CRM sync
 */
export async function getContactsNeedingCrmSync(
  config?: RepoConfig,
  limit = 100
): Promise<NetworkingContact[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  const table = getTableName(config);

  const rows = await sql<NetworkingContact[]>`
    SELECT * FROM ${sql(table)}
    WHERE status = 'fields_complete'
    AND crm_contact_id IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Get contacts for a specific event
 */
export async function getContactsByEvent(
  eventName: string,
  config?: RepoConfig,
  limit = 100
): Promise<NetworkingContact[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  const table = getTableName(config);

  const rows = await sql<NetworkingContact[]>`
    SELECT * FROM ${sql(table)}
    WHERE event_name = ${eventName}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Get contacts with pending videos (for polling)
 */
export async function getContactsWithPendingVideos(
  config?: RepoConfig,
  limit = 50
): Promise<NetworkingContact[]> {
  const sql = getDatabase();
  if (!sql) {
    return [];
  }

  const table = getTableName(config);

  const rows = await sql<NetworkingContact[]>`
    SELECT * FROM ${sql(table)}
    WHERE heygen_video_id IS NOT NULL
    AND heygen_video_url IS NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return rows;
}

// Backwards compatibility aliases
export { getDatabaseClient as getSupabaseClient };
