/**
 * Luma Events Repository
 *
 * Database operations for Luma events, guests, and contact associations.
 * Uses postgres.js for direct PostgreSQL connections.
 */

import { getDatabase, timedQuery } from "../../database/client.js";
import type { LumaScrapedEvent, LumaScrapedGuest } from "./scraper.js";

// ============================================================================
// Types
// ============================================================================

export interface DbLumaEvent {
  id: string;
  slug: string;
  name: string;
  url: string;
  event_date: string | null;
  event_end_date: string | null;
  timezone: string | null;
  location: string | null;
  location_address: string | null;
  is_online: boolean;
  description: string | null;
  cover_image_url: string | null;
  host_name: string | null;
  guest_count: number;
  scrape_status: "pending" | "in_progress" | "complete" | "failed" | "partial";
  scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbLumaGuest {
  id: string;
  luma_user_id: string | null;
  luma_profile_url: string;
  name: string;
  bio: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  twitter_handle: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbContactLumaAssociation {
  id: string;
  contact_id: string;
  guest_id: string;
  matched_at_event_id: string | null;
  match_score: number | null;
  match_type: "exact" | "fuzzy" | "manual" | "automatic";
  match_reason: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
}

export interface GuestMatch {
  guest_id: string;
  guest_name: string;
  match_score: number;
  match_reason: string;
}

// ============================================================================
// Event Operations
// ============================================================================

/**
 * Upsert a Luma event
 */
export async function upsertEvent(
  event: LumaScrapedEvent
): Promise<DbLumaEvent | null> {
  const sql = getDatabase();
  if (!sql) return null;

  // Get primary host name
  const hostName = event.hosts?.[0]?.name || null;

  return timedQuery("upsert", "luma_events", async () => {
    const rows = await sql<DbLumaEvent[]>`
      INSERT INTO luma_events (
        slug, name, url, event_date, event_end_date, timezone,
        location, location_address, is_online,
        description, cover_image_url, host_name,
        guest_count, scrape_status, scraped_at
      ) VALUES (
        ${event.slug},
        ${event.name},
        ${event.url},
        ${event.date || null},
        ${event.endDate || null},
        ${event.timezone || null},
        ${event.location || null},
        ${event.locationAddress || null},
        ${event.isOnline || false},
        ${event.description || null},
        ${event.coverImageUrl || null},
        ${hostName},
        ${event.guestCount},
        'complete',
        ${event.scrapedAt}
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        url = EXCLUDED.url,
        event_date = EXCLUDED.event_date,
        event_end_date = EXCLUDED.event_end_date,
        timezone = EXCLUDED.timezone,
        location = EXCLUDED.location,
        location_address = EXCLUDED.location_address,
        is_online = EXCLUDED.is_online,
        description = EXCLUDED.description,
        cover_image_url = EXCLUDED.cover_image_url,
        host_name = EXCLUDED.host_name,
        guest_count = EXCLUDED.guest_count,
        scrape_status = EXCLUDED.scrape_status,
        scraped_at = EXCLUDED.scraped_at,
        updated_at = NOW()
      RETURNING *
    `;
    return rows[0] || null;
  });
}

/**
 * Get event by slug
 */
export async function getEventBySlug(
  slug: string
): Promise<DbLumaEvent | null> {
  const sql = getDatabase();
  if (!sql) return null;

  return timedQuery("select", "luma_events", async () => {
    const rows = await sql<DbLumaEvent[]>`
      SELECT * FROM luma_events WHERE slug = ${slug} LIMIT 1
    `;
    return rows[0] || null;
  });
}

/**
 * Get all user events
 */
export async function getUserEvents(): Promise<DbLumaEvent[]> {
  const sql = getDatabase();
  if (!sql) return [];

  return timedQuery("select", "luma_events", async () => {
    const rows = await sql<DbLumaEvent[]>`
      SELECT e.*
      FROM luma_events e
      INNER JOIN luma_user_events ue ON e.id = ue.event_id
      ORDER BY e.event_date DESC
    `;
    return rows;
  });
}

// ============================================================================
// Guest Operations
// ============================================================================

/**
 * Upsert a Luma guest
 */
export async function upsertGuest(
  guest: LumaScrapedGuest
): Promise<DbLumaGuest | null> {
  const sql = getDatabase();
  if (!sql) return null;

  // Extract user ID from profile URL
  const lumaUserId = guest.lumaProfile.replace(/^https?:\/\/lu\.ma\/user\//, "");

  return timedQuery("upsert", "luma_guests", async () => {
    const rows = await sql<DbLumaGuest[]>`
      INSERT INTO luma_guests (
        luma_user_id, luma_profile_url, name, instagram_url, twitter_url
      ) VALUES (
        ${lumaUserId},
        ${guest.lumaProfile},
        ${guest.name},
        ${guest.instagram || null},
        ${guest.twitter || null}
      )
      ON CONFLICT (luma_user_id) DO UPDATE SET
        name = EXCLUDED.name,
        instagram_url = COALESCE(EXCLUDED.instagram_url, luma_guests.instagram_url),
        twitter_url = COALESCE(EXCLUDED.twitter_url, luma_guests.twitter_url),
        updated_at = NOW()
      RETURNING *
    `;
    return rows[0] || null;
  });
}

/**
 * Get guest by Luma user ID
 */
export async function getGuestByLumaId(
  lumaUserId: string
): Promise<DbLumaGuest | null> {
  const sql = getDatabase();
  if (!sql) return null;

  return timedQuery("select", "luma_guests", async () => {
    const rows = await sql<DbLumaGuest[]>`
      SELECT * FROM luma_guests WHERE luma_user_id = ${lumaUserId} LIMIT 1
    `;
    return rows[0] || null;
  });
}

/**
 * Search guests by name
 */
export async function searchGuestsByName(
  name: string,
  limit: number = 10
): Promise<DbLumaGuest[]> {
  const sql = getDatabase();
  if (!sql) return [];

  return timedQuery("select", "luma_guests", async () => {
    const rows = await sql<DbLumaGuest[]>`
      SELECT * FROM luma_guests
      WHERE name ILIKE ${'%' + name + '%'}
      LIMIT ${limit}
    `;
    return rows;
  });
}

// ============================================================================
// Event-Guest Association Operations
// ============================================================================

/**
 * Link a guest to an event
 */
export async function linkGuestToEvent(
  eventId: string,
  guestId: string,
  options: { isFeatured?: boolean; isHost?: boolean } = {}
): Promise<boolean> {
  const sql = getDatabase();
  if (!sql) return false;

  return timedQuery("upsert", "luma_event_guests", async () => {
    await sql`
      INSERT INTO luma_event_guests (event_id, guest_id, is_featured, is_host)
      VALUES (${eventId}, ${guestId}, ${options.isFeatured || false}, ${options.isHost || false})
      ON CONFLICT (event_id, guest_id) DO UPDATE SET
        is_featured = EXCLUDED.is_featured,
        is_host = EXCLUDED.is_host
    `;
    return true;
  });
}

/**
 * Get all guests for an event from database
 */
export async function getDbEventGuests(
  eventId: string
): Promise<DbLumaGuest[]> {
  const sql = getDatabase();
  if (!sql) return [];

  return timedQuery("select", "luma_event_guests", async () => {
    const rows = await sql<DbLumaGuest[]>`
      SELECT g.*
      FROM luma_guests g
      INNER JOIN luma_event_guests eg ON g.id = eg.guest_id
      WHERE eg.event_id = ${eventId}
    `;
    return rows;
  });
}

// ============================================================================
// Contact Association Operations
// ============================================================================

/**
 * Link a contact to a Luma guest
 */
export async function linkContactToGuest(
  contactId: string,
  guestId: string,
  options: {
    eventId?: string;
    matchScore?: number;
    matchType?: "exact" | "fuzzy" | "manual" | "automatic";
    matchReason?: string;
  } = {}
): Promise<boolean> {
  const sql = getDatabase();
  if (!sql) return false;

  return timedQuery("upsert", "contact_luma_associations", async () => {
    // Insert association
    await sql`
      INSERT INTO contact_luma_associations (
        contact_id, guest_id, matched_at_event_id,
        match_score, match_type, match_reason
      ) VALUES (
        ${contactId},
        ${guestId},
        ${options.eventId || null},
        ${options.matchScore || null},
        ${options.matchType || "automatic"},
        ${options.matchReason || null}
      )
      ON CONFLICT (contact_id, guest_id) DO UPDATE SET
        match_score = EXCLUDED.match_score,
        match_type = EXCLUDED.match_type,
        match_reason = EXCLUDED.match_reason
    `;

    // Update contact's primary luma_guest_id
    await sql`
      UPDATE networking_contacts
      SET luma_guest_id = ${guestId}, luma_matched_at = NOW()
      WHERE id = ${contactId}
    `;

    return true;
  });
}

/**
 * Get contact's Luma associations
 */
export async function getContactLumaAssociations(
  contactId: string
): Promise<Array<DbContactLumaAssociation & { guest: DbLumaGuest; event?: DbLumaEvent }>> {
  const sql = getDatabase();
  if (!sql) return [];

  return timedQuery("select", "contact_luma_associations", async () => {
    const rows = await sql`
      SELECT
        cla.*,
        row_to_json(g) as guest,
        row_to_json(e) as event
      FROM contact_luma_associations cla
      INNER JOIN luma_guests g ON cla.guest_id = g.id
      LEFT JOIN luma_events e ON cla.matched_at_event_id = e.id
      WHERE cla.contact_id = ${contactId}
    `;
    return rows as unknown as Array<DbContactLumaAssociation & { guest: DbLumaGuest; event?: DbLumaEvent }>;
  });
}

/**
 * Find potential guest matches for a contact
 */
export async function findGuestMatchesForContact(
  contactId: string,
  threshold: number = 0.7
): Promise<GuestMatch[]> {
  const sql = getDatabase();
  if (!sql) return [];

  return timedQuery("select", "luma_guests", async () => {
    const rows = await sql<GuestMatch[]>`
      SELECT * FROM find_luma_guest_matches(${contactId}, ${threshold})
    `;
    return rows;
  });
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Save a full scraped event with all hosts and guests
 */
export async function saveScrapedEvent(
  scrapedEvent: LumaScrapedEvent
): Promise<{ event: DbLumaEvent | null; hostCount: number; guestCount: number }> {
  // Upsert event
  const event = await upsertEvent(scrapedEvent);
  if (!event) {
    return { event: null, hostCount: 0, guestCount: 0 };
  }

  // Upsert all hosts and link to event with is_host=true
  let savedHosts = 0;
  for (const host of scrapedEvent.hosts) {
    if (!host.lumaProfile) continue;

    // Convert host to guest format for upsert
    const hostAsGuest: LumaScrapedGuest = {
      name: host.name,
      lumaProfile: host.lumaProfile,
    };

    const dbGuest = await upsertGuest(hostAsGuest);
    if (dbGuest) {
      const linked = await linkGuestToEvent(event.id, dbGuest.id, { isHost: true });
      if (linked) savedHosts++;
    }
  }

  // Upsert all guests and link to event
  let savedGuests = 0;
  for (const guest of scrapedEvent.guests) {
    const dbGuest = await upsertGuest(guest);
    if (dbGuest) {
      const linked = await linkGuestToEvent(event.id, dbGuest.id, { isHost: false });
      if (linked) savedGuests++;
    }
  }

  console.log(`[luma-repo] Saved event "${event.name}" with ${savedHosts} hosts and ${savedGuests} guests`);
  return { event, hostCount: savedHosts, guestCount: savedGuests };
}

/**
 * Auto-match all unmatched contacts to Luma guests
 */
export async function autoMatchContacts(
  threshold: number = 0.8
): Promise<number> {
  const sql = getDatabase();
  if (!sql) return 0;

  // Get contacts without Luma associations
  const contacts = await sql<Array<{ id: string; first_name: string; last_name: string }>>`
    SELECT id, first_name, last_name
    FROM networking_contacts
    WHERE luma_guest_id IS NULL
      AND first_name IS NOT NULL
  `;

  let matchCount = 0;

  for (const contact of contacts) {
    const matches = await findGuestMatchesForContact(contact.id, threshold);

    if (matches.length > 0) {
      const bestMatch = matches[0];
      const linked = await linkContactToGuest(contact.id, bestMatch.guest_id, {
        matchScore: bestMatch.match_score,
        matchType: bestMatch.match_score >= 0.95 ? "exact" : "fuzzy",
        matchReason: bestMatch.match_reason,
      });

      if (linked) {
        matchCount++;
        console.log(
          `[luma-repo] Matched ${contact.first_name} ${contact.last_name} -> ${bestMatch.guest_name} (${bestMatch.match_score})`
        );
      }
    }
  }

  return matchCount;
}
