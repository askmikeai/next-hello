/**
 * Luma Integration Client
 *
 * Fetches event attendees from Luma (lu.ma) to match contacts with events.
 */

import type { LumaConfig } from "../../config/types.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const LUMA_API_BASE = "https://api.lu.ma/public";

export interface LumaEvent {
  api_id: string;
  name: string;
  start_at: string;
  end_at: string;
  url: string;
  cover_url?: string;
  description?: string;
  geo_address_json?: {
    city?: string;
    region?: string;
    country?: string;
    full_address?: string;
  };
}

export interface LumaGuest {
  api_id: string;
  name: string;
  email?: string;
  phone?: string;
  approval_status: "approved" | "pending" | "declined" | "waitlisted";
  created_at: string;
  checked_in_at?: string;
}

export interface LumaEventWithGuests extends LumaEvent {
  guests: LumaGuest[];
}

function log(message: string): void {
  console.log(`[luma] ${message}`);
}

function getApiKey(config?: LumaConfig): string | null {
  return config?.apiKey ?? process.env.LUMA_API_KEY ?? null;
}

function getHeaders(apiKey: string): Record<string, string> {
  return {
    "x-luma-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Check if Luma is configured
 */
export function isLumaConfigured(config?: LumaConfig): boolean {
  return !!getApiKey(config);
}

/**
 * List events from a calendar
 */
export async function listCalendarEvents(
  calendarId: string,
  config?: LumaConfig
): Promise<LumaEvent[]> {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    log("Luma API key not configured");
    return [];
  }

  const endTimer = startTimer();
  try {
    const params = new URLSearchParams({
      calendar_api_id: calendarId,
    });

    const response = await fetch(
      `${LUMA_API_BASE}/v1/calendar/list-events?${params.toString()}`,
      {
        method: "GET",
        headers: getHeaders(apiKey),
      }
    );

    if (!response.ok) {
      log(`Failed to list calendar events: ${response.status}`);
      recordIntegrationCall("luma", "list_calendar_events", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      entries?: Array<{ event: LumaEvent }>;
    };

    recordIntegrationCall("luma", "list_calendar_events", "success", endTimer());
    return (data.entries ?? []).map((e) => e.event);
  } catch (error) {
    log(`Error listing calendar events: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "list_calendar_events", "failure", endTimer());
    return [];
  }
}

/**
 * Get guests for an event
 */
export async function getEventGuests(
  eventApiId: string,
  config?: LumaConfig
): Promise<LumaGuest[]> {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    log("Luma API key not configured");
    return [];
  }

  const endTimer = startTimer();
  const allGuests: LumaGuest[] = [];
  let cursor: string | undefined;

  try {
    // Paginate through all guests
    do {
      const params = new URLSearchParams({
        event_api_id: eventApiId,
      });
      if (cursor) {
        params.set("pagination_cursor", cursor);
      }

      const response = await fetch(
        `${LUMA_API_BASE}/v1/event/get-guests?${params.toString()}`,
        {
          method: "GET",
          headers: getHeaders(apiKey),
        }
      );

      if (!response.ok) {
        log(`Failed to get event guests: ${response.status}`);
        recordIntegrationCall("luma", "get_event_guests", "failure", endTimer());
        return allGuests;
      }

      const data = (await response.json()) as {
        entries?: Array<{ guest: LumaGuest }>;
        has_more?: boolean;
        next_cursor?: string;
      };

      const guests = (data.entries ?? []).map((e) => e.guest);
      allGuests.push(...guests);

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    recordIntegrationCall("luma", "get_event_guests", "success", endTimer());
    return allGuests;
  } catch (error) {
    log(`Error getting event guests: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("luma", "get_event_guests", "failure", endTimer());
    return allGuests;
  }
}

/**
 * Calculate similarity between two strings using Jaro-Winkler algorithm
 * Returns a score between 0 and 1, where 1 is an exact match
 */
function jaroWinklerSimilarity(s1: string, s2: string): number {
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();

  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
  const matches1 = new Array(str1.length).fill(false);
  const matches2 = new Array(str2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < str1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, str2.length);

    for (let j = start; j < end; j++) {
      if (matches2[j] || str1[i] !== str2[j]) continue;
      matches1[i] = true;
      matches2[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < str1.length; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / str1.length +
      matches / str2.length +
      (matches - transpositions / 2) / matches) /
    3;

  // Apply Winkler modification for common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(4, str1.length, str2.length); i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Match a contact name against event guests
 * Returns the best matching event if similarity exceeds threshold
 */
export interface NameMatchResult {
  event: LumaEvent;
  guest: LumaGuest;
  similarity: number;
}

export async function findEventByAttendee(
  contactName: string,
  config?: LumaConfig
): Promise<NameMatchResult | null> {
  const calendarId = config?.calendarId ?? process.env.LUMA_CALENDAR_ID;
  if (!calendarId) {
    log("Luma calendar ID not configured");
    return null;
  }

  const threshold = config?.nameMatchThreshold ?? 0.7;
  const events = await listCalendarEvents(calendarId, config);

  if (events.length === 0) {
    log("No events found in calendar");
    return null;
  }

  let bestMatch: NameMatchResult | null = null;

  for (const event of events) {
    const guests = await getEventGuests(event.api_id, config);

    for (const guest of guests) {
      if (!guest.name) continue;

      const similarity = jaroWinklerSimilarity(contactName, guest.name);

      if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { event, guest, similarity };
      }
    }
  }

  if (bestMatch) {
    log(
      `Matched "${contactName}" to "${bestMatch.guest.name}" at "${bestMatch.event.name}" (similarity: ${bestMatch.similarity.toFixed(2)})`
    );
  }

  return bestMatch;
}

/**
 * Get all events with their guests (for caching/batch processing)
 */
export async function getAllEventsWithGuests(
  config?: LumaConfig
): Promise<LumaEventWithGuests[]> {
  const calendarId = config?.calendarId ?? process.env.LUMA_CALENDAR_ID;
  if (!calendarId) {
    log("Luma calendar ID not configured");
    return [];
  }

  const events = await listCalendarEvents(calendarId, config);
  const eventsWithGuests: LumaEventWithGuests[] = [];

  for (const event of events) {
    const guests = await getEventGuests(event.api_id, config);
    eventsWithGuests.push({ ...event, guests });
  }

  return eventsWithGuests;
}

/**
 * Format event info for display
 */
export function formatEventInfo(event: LumaEvent): string {
  const date = new Date(event.start_at);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let info = `${event.name} on ${formattedDate}`;

  if (event.geo_address_json?.city) {
    info += ` in ${event.geo_address_json.city}`;
    if (event.geo_address_json.region) {
      info += `, ${event.geo_address_json.region}`;
    }
  }

  return info;
}
