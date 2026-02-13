import type { IncomingMessage, ServerResponse } from "http";
import type { NetworkingEventConfig } from "../config/types.js";
import { getDatabase } from "../database/client.js";
import { updateHeyGenVideo } from "../contacts/index.js";
import {
  parseWebhookPayload,
  type HeyGenWebhookPayload,
} from "../integrations/heygen/client.js";
import { generateVoiceMessage } from "../integrations/elevenlabs/client.js";
import {
  parseJsonBody,
  sendSuccess,
  sendError,
  logWebhook,
  registerWebhookRoute,
} from "./registry.js";
import { addJob } from "../queue/client.js";
import type { OutboundMessageJob } from "../swarm/types.js";
import { createCorrelationId } from "../observability/logger.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const WEBHOOK_PATH = "/webhooks/networking-event/heygen";

interface ContactVideoInfo {
  phone_number: string;
  first_name: string | null;
}

const VOICE_DELAY_MS = 5_000; // 5 seconds delay between video and voice

/**
 * Generate and queue a voice follow-up message
 */
async function generateAndQueueVoiceFollowUp(
  phoneNumber: string,
  firstName: string | null,
  config: NetworkingEventConfig
): Promise<void> {
  const elevenlabsConfig = config.elevenlabs;
  if (!elevenlabsConfig?.voiceId) {
    logWebhook("heygen", "elevenlabs_not_configured");
    return;
  }

  const name = firstName || "friend";
  const scriptTemplate = elevenlabsConfig.scriptTemplate ||
    "Hey {name}! I would love to have a cup of coffee with you. Would you like to schedule a meeting with me?";

  logWebhook("heygen", "generating_voice_followup", { phone: phoneNumber });

  try {
    const result = await generateVoiceMessage(elevenlabsConfig, scriptTemplate, name);

    if (result.status !== "completed" || !result.audioData) {
      logWebhook("heygen", "voice_generation_failed", { error: result.error });
      return;
    }

    // Save the audio file
    const mediaDir = process.env.MEDIA_DIR || "/app/data/media/voice";
    await mkdir(mediaDir, { recursive: true });

    const timestamp = Date.now();
    const phoneClean = phoneNumber.replace(/[^0-9]/g, "");
    const filename = `voice_${phoneClean}_${timestamp}.mp3`;
    const audioPath = join(mediaDir, filename);

    await writeFile(audioPath, result.audioData);

    // Queue voice message with a delay after video
    const outboundJob: OutboundMessageJob = {
      correlationId: createCorrelationId(),
      phoneNumber,
      channel: "whatsapp",
      messageType: "voice",
      content: audioPath,
      metadata: { followUpToVideo: true },
    };

    await addJob("outbound-messages", outboundJob, { delay: VOICE_DELAY_MS });
    logWebhook("heygen", "voice_followup_queued", { phone: phoneNumber });
  } catch (error) {
    logWebhook("heygen", "voice_error", error);
  }
}

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

  // Handle based on event type
  switch (payload.event_type) {
    case "avatar_video.success":
    case "video.success":
      await handleVideoSuccess(payload, config);
      break;

    case "avatar_video.fail":
    case "video.fail":
      await handleVideoFailed(payload);
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
): Promise<void> {
  const { video_id, url } = payload.event_data;

  logWebhook("heygen", "video_success", { video_id, url });

  if (!video_id) {
    logWebhook("heygen", "no_video_id");
    return;
  }

  const sql = getDatabase();
  if (!sql) {
    logWebhook("heygen", "database_not_configured");
    return;
  }

  const tableName = config.database?.tableName ?? "networking_contacts";

  try {
    // Find contact with this video ID
    const contacts = await sql<ContactVideoInfo[]>`
      SELECT phone_number, first_name
      FROM ${sql(tableName)}
      WHERE heygen_video_id = ${video_id}
      LIMIT 1
    `;

    const contact = contacts[0];

    if (!contact) {
      logWebhook("heygen", "contact_not_found", { video_id });
      return;
    }

    // Update with video URL
    await updateHeyGenVideo(contact.phone_number, video_id, url || null);

    logWebhook("heygen", "video_url_saved", {
      phone: contact.phone_number,
      url,
    });

    // Queue the video to be sent to the contact
    if (url && contact.phone_number) {
      const firstName = contact.first_name || "there";
      const outboundJob: OutboundMessageJob = {
        correlationId: createCorrelationId(),
        phoneNumber: contact.phone_number,
        channel: "whatsapp",
        messageType: "video",
        content: url,
        caption: `Hey ${firstName}! Look at this workflow - this video was created just for you by AI automation, or what I like to call a swarm of agents working on your behalf in the background. Let's connect so we can explore how AI can transform your business or personal life!`,
        metadata: { videoId: video_id },
      };

      await addJob("outbound-messages", outboundJob);
      logWebhook("heygen", "video_send_queued", {
        phone: contact.phone_number,
        videoId: video_id,
      });

      // Generate and queue voice follow-up
      await generateAndQueueVoiceFollowUp(contact.phone_number, contact.first_name, config);
    }
  } catch (error) {
    logWebhook("heygen", "error", error);
  }
}

/**
 * Handle video generation failure
 */
async function handleVideoFailed(
  payload: HeyGenWebhookPayload,
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
