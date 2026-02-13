/**
 * Video Poller Worker
 *
 * Polls HeyGen API for video completion status.
 * Runs every minute to check for pending videos and sends them when ready.
 */

import { getContactsWithPendingVideos, updateHeyGenVideo } from "../contacts/index.js";
import { getVideoStatus } from "../integrations/heygen/client.js";
import { generateVoiceMessage } from "../integrations/elevenlabs/client.js";
import { addJob } from "../queue/client.js";
import { createLogger, createCorrelationId } from "../observability/logger.js";
import type { OutboundMessageJob } from "../swarm/types.js";
import type { NetworkingContact, ElevenLabsConfig } from "../config/types.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const logger = createLogger({ component: "video-poller" });

const POLL_INTERVAL_MS = 60_000; // 1 minute
const VOICE_DELAY_MS = 5_000; // 5 seconds delay between video and voice

// Load config for ElevenLabs settings
let elevenlabsConfig: ElevenLabsConfig | null = null;
async function loadElevenLabsConfig(): Promise<ElevenLabsConfig | null> {
  try {
    const configPath = process.env.NEXTHELLO_CONFIG || "./nexthello.config.json";
    const { readFileSync } = await import("fs");
    const configData = JSON.parse(readFileSync(configPath, "utf-8"));
    const config = configData.elevenlabs || null;
    if (config) {
      logger.info({ voiceId: config.voiceId, hasScript: !!config.scriptTemplate }, "ElevenLabs config loaded");
    }
    return config;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Could not load ElevenLabs config");
    return null;
  }
}
// Load config on module init
loadElevenLabsConfig().then(config => {
  elevenlabsConfig = config;
});

/**
 * Build the personalized video message
 */
function buildVideoCaption(firstName: string | null | undefined): string {
  const name = firstName || "there";
  return `Hey ${name}! Look at this workflow - this video was created just for you by AI automation, or what I like to call a swarm of agents working on your behalf in the background. Let's connect so we can explore how AI can transform your business or personal life!`;
}

/**
 * Generate and queue a voice message to follow up after video
 */
async function generateAndQueueVoiceMessage(contact: NetworkingContact): Promise<void> {
  if (!elevenlabsConfig?.voiceId) {
    logger.debug("ElevenLabs not configured, skipping voice message");
    return;
  }

  const firstName = contact.first_name || "friend";
  const scriptTemplate = elevenlabsConfig.scriptTemplate ||
    "Hey {name}! I would love to have a cup of coffee with you. Would you like to schedule a meeting with me?";

  logger.info({ phoneNumber: contact.phone_number }, "Generating voice follow-up message");

  try {
    const result = await generateVoiceMessage(elevenlabsConfig, scriptTemplate, firstName);

    if (result.status !== "completed" || !result.audioData) {
      logger.error({ error: result.error }, "Failed to generate voice message");
      return;
    }

    // Save the audio file
    const mediaDir = process.env.MEDIA_DIR || "/app/data/media/voice";
    await mkdir(mediaDir, { recursive: true });

    const timestamp = Date.now();
    const phoneClean = contact.phone_number.replace(/[^0-9]/g, "");
    const filename = `voice_${phoneClean}_${timestamp}.mp3`;
    const audioPath = join(mediaDir, filename);

    await writeFile(audioPath, result.audioData);
    logger.info({ audioPath, size: result.audioData.length }, "Voice message saved");

    // Queue voice message with a delay after video
    const outboundJob: OutboundMessageJob = {
      correlationId: createCorrelationId(),
      phoneNumber: contact.phone_number,
      channel: "whatsapp",
      messageType: "voice",
      content: audioPath,
      metadata: { followUpToVideo: true },
    };

    await addJob("outbound-messages", outboundJob, { delay: VOICE_DELAY_MS });
    logger.info({ phoneNumber: contact.phone_number }, "Voice follow-up queued");
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Error generating voice message");
  }
}

/**
 * Check a single video and send if ready
 */
async function checkAndSendVideo(contact: NetworkingContact): Promise<boolean> {
  const { phone_number, heygen_video_id } = contact;

  if (!heygen_video_id) {
    return false;
  }

  logger.debug({ phoneNumber: phone_number, videoId: heygen_video_id }, "Checking video status");

  const result = await getVideoStatus(heygen_video_id);

  if (result.status === "completed" && result.videoUrl) {
    logger.info({ phoneNumber: phone_number, videoId: heygen_video_id }, "Video ready, updating and sending");

    // Update contact with video URL
    try {
      await updateHeyGenVideo(phone_number, heygen_video_id, result.videoUrl);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to update video URL");
      return false;
    }

    // Queue video for sending
    const outboundJob: OutboundMessageJob = {
      correlationId: createCorrelationId(),
      phoneNumber: phone_number,
      channel: "whatsapp",
      messageType: "video",
      content: result.videoUrl,
      caption: buildVideoCaption(contact.first_name),
      metadata: { videoId: heygen_video_id },
    };

    await addJob("outbound-messages", outboundJob);
    logger.info({ phoneNumber: phone_number, videoId: heygen_video_id }, "Video queued for delivery");

    // Generate and queue voice follow-up message
    await generateAndQueueVoiceMessage(contact);

    return true;
  }

  if (result.status === "failed") {
    logger.warn({ phoneNumber: phone_number, videoId: heygen_video_id, error: result.error }, "Video generation failed");
    // Could mark as failed in DB to stop polling
  }

  return false;
}

/**
 * Run one polling cycle
 */
async function pollOnce(): Promise<{ checked: number; sent: number }> {
  const pendingVideos = await getContactsWithPendingVideos();

  if (pendingVideos.length === 0) {
    return { checked: 0, sent: 0 };
  }

  logger.info({ count: pendingVideos.length }, "Found pending videos to check");

  let sent = 0;
  for (const contact of pendingVideos) {
    try {
      const wasSent = await checkAndSendVideo(contact);
      if (wasSent) sent++;
    } catch (error) {
      logger.error(
        { phoneNumber: contact.phone_number, error: error instanceof Error ? error.message : String(error) },
        "Error checking video"
      );
    }
  }

  return { checked: pendingVideos.length, sent };
}

/**
 * Start the video poller
 */
export function startVideoPoller(): NodeJS.Timeout {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting video poller");

  // Run immediately on start
  pollOnce().then(({ checked, sent }) => {
    if (checked > 0) {
      logger.info({ checked, sent }, "Initial poll complete");
    }
  });

  // Then run on interval
  const interval = setInterval(async () => {
    try {
      const { checked, sent } = await pollOnce();
      if (checked > 0) {
        logger.info({ checked, sent }, "Poll cycle complete");
      } else {
        logger.debug("Poll cycle: no pending videos");
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "Poll cycle failed");
    }
  }, POLL_INTERVAL_MS);

  return interval;
}

/**
 * Stop the video poller
 */
export function stopVideoPoller(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  logger.info("Video poller stopped");
}

// If run directly as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info("Running video poller as standalone script");
  startVideoPoller();
}
