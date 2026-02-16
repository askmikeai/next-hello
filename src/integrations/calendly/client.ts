import type { CalendlyConfig } from "../../config/types.js";
import crypto from "crypto";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const CALENDLY_API_BASE = "https://api.calendly.com";

export interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  schedulingUrl: string;
  timezone: string;
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  schedulingUrl: string;
  duration: number;
  active: boolean;
}

export interface CalendlyEvent {
  uri: string;
  name: string;
  status: "active" | "canceled";
  startTime: string;
  endTime: string;
  eventType: string;
  location?: {
    type: string;
    location?: string;
    joinUrl?: string;
  };
  invitees?: Array<{
    uri: string;
    email: string;
    name: string;
    status: string;
  }>;
}

export interface CalendlyWebhookPayload {
  event: "invitee.created" | "invitee.canceled";
  created_at: string;
  created_by: string;
  payload: {
    uri: string;
    email: string;
    name: string;
    status: string;
    timezone: string;
    event: string;
    scheduled_event: {
      uri: string;
      name: string;
      status: string;
      start_time: string;
      end_time: string;
      event_type: string;
    };
    questions_and_answers?: Array<{
      question: string;
      answer: string;
    }>;
    tracking?: {
      utm_source?: string;
      utm_medium?: string;
    };
  };
}

function getApiKey(): string | null {
  return process.env.CALENDLY_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[calendly] ${message}`);
}

/**
 * Get authenticated headers
 */
function getHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("CALENDLY_API_KEY not configured");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<CalendlyUser | null> {
  const endTimer = startTimer();
  try {
    const response = await fetch(`${CALENDLY_API_BASE}/users/me`, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      log(`Failed to get current user: ${response.status}`);
      recordIntegrationCall("calendly", "get_user", "failure", endTimer());
      return null;
    }

    const data = (await response.json()) as {
      resource?: {
        uri: string;
        name: string;
        email: string;
        scheduling_url: string;
        timezone: string;
      };
    };

    if (!data.resource) {
      recordIntegrationCall("calendly", "get_user", "failure", endTimer());
      return null;
    }

    recordIntegrationCall("calendly", "get_user", "success", endTimer());
    return {
      uri: data.resource.uri,
      name: data.resource.name,
      email: data.resource.email,
      schedulingUrl: data.resource.scheduling_url,
      timezone: data.resource.timezone,
    };
  } catch (error) {
    log(`Error getting user: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("calendly", "get_user", "failure", endTimer());
    return null;
  }
}

/**
 * List event types for an organization
 */
export async function listEventTypes(
  config: CalendlyConfig,
): Promise<CalendlyEventType[]> {
  if (!config.organizationUri) {
    log("Organization URI not configured");
    return [];
  }

  const endTimer = startTimer();
  try {
    const params = new URLSearchParams({
      organization: config.organizationUri,
      active: "true",
    });

    const response = await fetch(
      `${CALENDLY_API_BASE}/event_types?${params.toString()}`,
      {
        method: "GET",
        headers: getHeaders(),
      },
    );

    if (!response.ok) {
      log(`Failed to list event types: ${response.status}`);
      recordIntegrationCall("calendly", "list_event_types", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      collection?: Array<{
        uri: string;
        name: string;
        slug: string;
        scheduling_url: string;
        duration: number;
        active: boolean;
      }>;
    };

    recordIntegrationCall("calendly", "list_event_types", "success", endTimer());
    return (data.collection ?? []).map((et) => ({
      uri: et.uri,
      name: et.name,
      slug: et.slug,
      schedulingUrl: et.scheduling_url,
      duration: et.duration,
      active: et.active,
    }));
  } catch (error) {
    log(`Error listing event types: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("calendly", "list_event_types", "failure", endTimer());
    return [];
  }
}

/**
 * Get a scheduled event by URI
 */
export async function getEvent(eventUri: string): Promise<CalendlyEvent | null> {
  const endTimer = startTimer();
  try {
    const response = await fetch(eventUri, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      log(`Failed to get event: ${response.status}`);
      recordIntegrationCall("calendly", "get_event", "failure", endTimer());
      return null;
    }

    const data = (await response.json()) as {
      resource?: {
        uri: string;
        name: string;
        status: "active" | "canceled";
        start_time: string;
        end_time: string;
        event_type: string;
        location?: {
          type: string;
          location?: string;
          join_url?: string;
        };
      };
    };

    if (!data.resource) {
      recordIntegrationCall("calendly", "get_event", "failure", endTimer());
      return null;
    }

    recordIntegrationCall("calendly", "get_event", "success", endTimer());
    return {
      uri: data.resource.uri,
      name: data.resource.name,
      status: data.resource.status,
      startTime: data.resource.start_time,
      endTime: data.resource.end_time,
      eventType: data.resource.event_type,
      location: data.resource.location
        ? {
            type: data.resource.location.type,
            location: data.resource.location.location,
            joinUrl: data.resource.location.join_url,
          }
        : undefined,
    };
  } catch (error) {
    log(`Error getting event: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("calendly", "get_event", "failure", endTimer());
    return null;
  }
}

/**
 * Get event invitees
 */
export async function getEventInvitees(
  eventUri: string,
): Promise<Array<{ uri: string; email: string; name: string; status: string }>> {
  const endTimer = startTimer();
  try {
    const response = await fetch(`${eventUri}/invitees`, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      log(`Failed to get invitees: ${response.status}`);
      recordIntegrationCall("calendly", "get_event_invitees", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      collection?: Array<{
        uri: string;
        email: string;
        name: string;
        status: string;
      }>;
    };

    recordIntegrationCall("calendly", "get_event_invitees", "success", endTimer());
    return (data.collection ?? []).map((inv) => ({
      uri: inv.uri,
      email: inv.email,
      name: inv.name,
      status: inv.status,
    }));
  } catch (error) {
    log(`Error getting invitees: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("calendly", "get_event_invitees", "failure", endTimer());
    return [];
  }
}

/**
 * Create a webhook subscription
 */
export async function createWebhookSubscription(
  config: CalendlyConfig,
  callbackUrl: string,
  events: Array<"invitee.created" | "invitee.canceled"> = ["invitee.created"],
): Promise<string | null> {
  if (!config.organizationUri) {
    log("Organization URI not configured");
    return null;
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        url: callbackUrl,
        events,
        organization: config.organizationUri,
        scope: "organization",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log(`Failed to create webhook: ${response.status} - ${error}`);
      recordIntegrationCall("calendly", "create_webhook_subscription", "failure", endTimer());
      return null;
    }

    const data = (await response.json()) as {
      resource?: { uri: string };
    };

    recordIntegrationCall("calendly", "create_webhook_subscription", "success", endTimer());
    return data.resource?.uri ?? null;
  } catch (error) {
    log(`Error creating webhook: ${error instanceof Error ? error.message : String(error)}`);
    recordIntegrationCall("calendly", "create_webhook_subscription", "failure", endTimer());
    return null;
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  signingKey: string,
): boolean {
  if (!signingKey) {
    return false;
  }

  try {
    const hmac = crypto.createHmac("sha256", signingKey);
    hmac.update(payload);
    const expectedSignature = hmac.digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  } catch {
    return false;
  }
}

/**
 * Parse webhook payload
 */
export function parseWebhookPayload(
  body: unknown,
): CalendlyWebhookPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as Record<string, unknown>;

  if (!payload.event || !payload.payload) {
    return null;
  }

  return payload as unknown as CalendlyWebhookPayload;
}

/**
 * Get scheduling link (either from config or generate one)
 */
export function getSchedulingLink(config: CalendlyConfig): string | null {
  return config.schedulingLink ?? null;
}

/**
 * Format event for display
 */
export function formatEventSummary(event: CalendlyEvent): string {
  const date = new Date(event.startTime);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${event.name} on ${formattedDate} at ${formattedTime}`;
}
