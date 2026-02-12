import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  ContactStatus,
  NetworkingContact,
  SupabaseConfig,
} from "../config/types.js";

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get table name from env or config
 */
function getDefaultTableName(): string {
  return process.env.SUPABASE_TABLE ?? "tech_founders_contacts";
}

/**
 * Get or create Supabase client singleton
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  supabaseInstance = createClient(supabaseUrl, supabaseKey);
  return supabaseInstance;
}

/**
 * Reset client (for testing)
 */
export function resetSupabaseClient(): void {
  supabaseInstance = null;
}

function getTableName(config?: SupabaseConfig): string {
  return config?.tableName ?? getDefaultTableName();
}

/**
 * Find contact by phone number
 */
export async function findContactByPhone(
  phoneNumber: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase findContactByPhone error: ${error.message}`);
  }

  return data as NetworkingContact | null;
}

/**
 * Find contact by email
 */
export async function findContactByEmail(
  email: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase findContactByEmail error: ${error.message}`);
  }

  return data as NetworkingContact | null;
}

/**
 * Find contact by CRM ID
 */
export async function findContactByCrmId(
  crmContactId: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("crm_contact_id", crmContactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase findContactByCrmId error: ${error.message}`);
  }

  return data as NetworkingContact | null;
}

/**
 * Create new contact
 */
export async function createContact(
  contact: Partial<NetworkingContact>,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  const client = getSupabaseClient();

  const now = new Date().toISOString();
  const insertData = {
    ...contact,
    status: contact.status ?? "new",
    created_at: now,
    updated_at: now,
  };

  // If Supabase not configured, return mock contact for demo mode
  if (!client) {
    console.log("[supabase] Demo mode: Supabase not configured, using in-memory contact");
    return {
      id: Date.now(),
      ...insertData,
    } as NetworkingContact;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase createContact error: ${error.message}`);
  }

  return data as NetworkingContact;
}

/**
 * Update contact by phone number
 */
export async function updateContactByPhone(
  phoneNumber: string,
  updates: Partial<NetworkingContact>,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  const client = getSupabaseClient();

  // If Supabase not configured, return mock updated contact for demo mode
  if (!client) {
    console.log(`[supabase] Demo mode: Would update ${phoneNumber} with`, Object.keys(updates));
    return {
      id: Date.now(),
      phone_number: phoneNumber,
      ...updates,
      updated_at: new Date().toISOString(),
    } as NetworkingContact;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("phone_number", phoneNumber)
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase updateContactByPhone error: ${error.message}`);
  }

  return data as NetworkingContact;
}

/**
 * Update contact by ID
 */
export async function updateContactById(
  id: number,
  updates: Partial<NetworkingContact>,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  const client = getSupabaseClient();

  // If Supabase not configured, return mock updated contact for demo mode
  if (!client) {
    console.log(`[supabase] Demo mode: Would update contact ${id} with`, Object.keys(updates));
    return {
      id,
      ...updates,
      updated_at: new Date().toISOString(),
    } as NetworkingContact;
  }

  const { data, error } = await client
    .from(getTableName(config))
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase updateContactById error: ${error.message}`);
  }

  return data as NetworkingContact;
}

/**
 * Update contact status
 */
export async function updateContactStatus(
  phoneNumber: string,
  status: ContactStatus,
  config?: SupabaseConfig,
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
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      heygen_video_id: videoId,
      heygen_video_url: videoUrl,
    },
    config,
  );
}

/**
 * Update Calendly booking info
 */
export async function updateCalendlyBooking(
  phoneNumber: string,
  eventUri: string,
  scheduledAt: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      calendly_event_uri: eventUri,
      calendly_scheduled_at: scheduledAt,
      status: "meeting_scheduled",
    },
    config,
  );
}

/**
 * Update CRM sync info
 */
export async function updateCrmSync(
  phoneNumber: string,
  crmContactId: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      crm_contact_id: crmContactId,
      crm_synced_at: new Date().toISOString(),
      status: "synced",
    },
    config,
  );
}

/**
 * Mark personalized message as sent
 */
export async function markMessageSent(
  phoneNumber: string,
  config?: SupabaseConfig,
): Promise<NetworkingContact> {
  return updateContactByPhone(
    phoneNumber,
    {
      sent_personalized_message: true,
      last_contact_date: new Date().toISOString().split("T")[0],
    },
    config,
  );
}

/**
 * Get contacts by status
 */
export async function getContactsByStatus(
  status: ContactStatus,
  config?: SupabaseConfig,
  limit = 100,
): Promise<NetworkingContact[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase getContactsByStatus error: ${error.message}`);
  }

  return (data ?? []) as NetworkingContact[];
}

/**
 * Get contacts needing CRM sync
 */
export async function getContactsNeedingCrmSync(
  config?: SupabaseConfig,
  limit = 100,
): Promise<NetworkingContact[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("status", "fields_complete")
    .is("crm_contact_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase getContactsNeedingCrmSync error: ${error.message}`);
  }

  return (data ?? []) as NetworkingContact[];
}

/**
 * Get contacts for a specific event
 */
export async function getContactsByEvent(
  eventName: string,
  config?: SupabaseConfig,
  limit = 100,
): Promise<NetworkingContact[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from(getTableName(config))
    .select("*")
    .eq("event_name", eventName)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase getContactsByEvent error: ${error.message}`);
  }

  return (data ?? []) as NetworkingContact[];
}
