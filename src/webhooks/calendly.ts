import type { IncomingMessage, ServerResponse } from "http";
import type { NetworkingEventConfig, SupabaseConfig } from "../config/types.js";
import {
  findContactByEmail,
  updateCalendlyBooking,
  updateContactByPhone,
} from "../contacts/supabase-repo.js";
import {
  parseWebhookPayload,
  verifyWebhookSignature,
  formatEventSummary,
  getEvent,
  type CalendlyWebhookPayload,
} from "../integrations/calendly/client.js";
import {
  getRawBody,
  sendSuccess,
  sendError,
  logWebhook,
  registerWebhookRoute,
} from "./registry.js";

const WEBHOOK_PATH = "/webhooks/networking-event/calendly";

/**
 * Handle Calendly webhook events
 */
async function handleCalendlyWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  config: NetworkingEventConfig,
): Promise<boolean> {
  // Only accept POST
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return true;
  }

  // Get raw body for signature verification
  const rawBody = await getRawBody(req);

  if (!rawBody) {
    sendError(res, 400, "Empty body");
    return true;
  }

  // Verify signature if signing key configured
  const signingKey = config.calendly?.webhookSigningKey;
  if (signingKey) {
    const signature = req.headers["calendly-webhook-signature"] as string;

    if (!signature || !verifyWebhookSignature(rawBody, signature, signingKey)) {
      logWebhook("calendly", "invalid_signature");
      sendError(res, 401, "Invalid signature");
      return true;
    }
  }

  // Parse payload
  let payload: CalendlyWebhookPayload | null;
  try {
    payload = JSON.parse(rawBody) as CalendlyWebhookPayload;
  } catch {
    sendError(res, 400, "Invalid JSON");
    return true;
  }

  if (!payload || !payload.event || !payload.payload) {
    sendError(res, 400, "Invalid payload structure");
    return true;
  }

  logWebhook("calendly", payload.event, {
    email: payload.payload.email,
    name: payload.payload.name,
  });

  // Handle event types
  const supabaseConfig = config.supabase ?? {};

  switch (payload.event) {
    case "invitee.created":
      await handleInviteeCreated(payload, config, supabaseConfig);
      break;

    case "invitee.canceled":
      await handleInviteeCanceled(payload, config, supabaseConfig);
      break;

    default:
      logWebhook("calendly", "unknown_event", payload.event);
  }

  sendSuccess(res, "Webhook processed");
  return true;
}

/**
 * Handle new meeting booked
 */
async function handleInviteeCreated(
  payload: CalendlyWebhookPayload,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  const { email, name, scheduled_event } = payload.payload;

  logWebhook("calendly", "invitee_created", {
    email,
    name,
    event: scheduled_event.name,
    startTime: scheduled_event.start_time,
  });

  // Find contact by email
  const contact = await findContactByEmail(email, supabaseConfig);

  if (!contact) {
    logWebhook("calendly", "contact_not_found", { email });
    return;
  }

  // Update contact with meeting info
  await updateCalendlyBooking(
    contact.phone_number,
    scheduled_event.uri,
    scheduled_event.start_time,
    supabaseConfig,
  );

  logWebhook("calendly", "contact_updated", {
    phone: contact.phone_number,
    eventUri: scheduled_event.uri,
  });

  // Optionally get full event details
  try {
    const eventDetails = await getEvent(scheduled_event.uri);
    if (eventDetails) {
      const summary = formatEventSummary(eventDetails);
      logWebhook("calendly", "meeting_scheduled", { summary });

      // Could send notification or update with join URL
      if (eventDetails.location?.joinUrl) {
        await updateContactByPhone(
          contact.phone_number,
          {
            // Store join URL in a custom field or notes
          },
          supabaseConfig,
        );
      }
    }
  } catch (error) {
    logWebhook("calendly", "event_details_error", error);
  }
}

/**
 * Handle meeting canceled
 */
async function handleInviteeCanceled(
  payload: CalendlyWebhookPayload,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  const { email, scheduled_event } = payload.payload;

  logWebhook("calendly", "invitee_canceled", {
    email,
    event: scheduled_event.name,
  });

  // Find contact and clear meeting info
  const contact = await findContactByEmail(email, supabaseConfig);

  if (!contact) {
    logWebhook("calendly", "contact_not_found", { email });
    return;
  }

  // Clear Calendly fields but don't change status back
  await updateContactByPhone(
    contact.phone_number,
    {
      calendly_event_uri: null,
      calendly_scheduled_at: null,
    },
    supabaseConfig,
  );

  logWebhook("calendly", "meeting_cleared", { phone: contact.phone_number });
}

/**
 * Get the webhook path for registration
 */
export function getCalendlyWebhookPath(): string {
  return WEBHOOK_PATH;
}

// Register route
registerWebhookRoute(WEBHOOK_PATH, handleCalendlyWebhook);

export { handleCalendlyWebhook };
