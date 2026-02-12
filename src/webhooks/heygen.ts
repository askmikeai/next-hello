import type { IncomingMessage, ServerResponse } from "http";
import type { NetworkingEventConfig, SupabaseConfig } from "../config/types.js";
import { getSupabaseClient } from "../contacts/supabase-repo.js";
import {
  parseWebhookPayload,
  type HeyGenWebhookPayload,
} from "../integrations/heygen/client.js";
import {
  parseJsonBody,
  sendSuccess,
  sendError,
  logWebhook,
  registerWebhookRoute,
} from "./registry.js";

const WEBHOOK_PATH = "/webhooks/networking-event/heygen";

/**
 * Handle HeyGen webhook events
 */
async function handleHeyGenWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  config: NetworkingEventConfig,
): Promise<boolean> {
  // Only accept POST
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return true;
  }

  // Parse JSON body
  const body = await parseJsonBody<unknown>(req);

  if (!body) {
    sendError(res, 400, "Invalid JSON body");
    return true;
  }

  // Parse webhook payload
  const payload = parseWebhookPayload(body);

  if (!payload) {
    sendError(res, 400, "Invalid payload structure");
    return true;
  }

  logWebhook("heygen", payload.event_type, {
    videoId: payload.event_data.video_id,
    status: payload.event_data.status,
  });

  const supabaseConfig = config.supabase ?? {};

  // Handle based on event type
  switch (payload.event_type) {
    case "avatar_video.success":
    case "video.success":
      await handleVideoSuccess(payload, config, supabaseConfig);
      break;

    case "avatar_video.fail":
    case "video.fail":
      await handleVideoFailed(payload, config, supabaseConfig);
      break;

    default:
      logWebhook("heygen", "unknown_event", payload.event_type);
  }

  sendSuccess(res, "Webhook processed");
  return true;
}

/**
 * Handle video generation success
 */
async function handleVideoSuccess(
  payload: HeyGenWebhookPayload,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  const { video_id, url } = payload.event_data;

  logWebhook("heygen", "video_success", { video_id, url });

  if (!video_id) {
    logWebhook("heygen", "no_video_id");
    return;
  }

  // Find contact with this video ID
  const client = getSupabaseClient();
  if (!client) {
    logWebhook("heygen", "supabase_not_configured");
    return;
  }

  const tableName = supabaseConfig.tableName ?? "networking_contacts";

  try {
    // Find contact with this video ID
    const { data: contact, error } = await client
      .from(tableName)
      .select("phone_number")
      .eq("heygen_video_id", video_id)
      .maybeSingle();

    if (error) {
      logWebhook("heygen", "find_contact_error", error.message);
      return;
    }

    if (!contact) {
      logWebhook("heygen", "contact_not_found", { video_id });
      return;
    }

    // Update with video URL
    const { error: updateError } = await client
      .from(tableName)
      .update({
        heygen_video_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("heygen_video_id", video_id);

    if (updateError) {
      logWebhook("heygen", "update_error", updateError.message);
      return;
    }

    logWebhook("heygen", "video_url_saved", {
      phone: contact.phone_number,
      url,
    });

    // Optionally could trigger sending the video to the contact
    // This would require access to the messaging channel
  } catch (error) {
    logWebhook("heygen", "error", error);
  }
}

/**
 * Handle video generation failure
 */
async function handleVideoFailed(
  payload: HeyGenWebhookPayload,
  config: NetworkingEventConfig,
  supabaseConfig: SupabaseConfig,
): Promise<void> {
  const { video_id, error } = payload.event_data;

  logWebhook("heygen", "video_failed", { video_id, error });

  // Could mark the contact for retry or notify
  // For now just log
}

/**
 * Get the webhook path for registration
 */
export function getHeyGenWebhookPath(): string {
  return WEBHOOK_PATH;
}

// Register route
registerWebhookRoute(WEBHOOK_PATH, handleHeyGenWebhook);

export { handleHeyGenWebhook };
