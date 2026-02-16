import type { HeyGenConfig } from "../../config/types.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const HEYGEN_API_BASE = "https://api.heygen.com/v2";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export type HeyGenVideoStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface HeyGenVideoResult {
  videoId: string;
  videoUrl: string | null;
  status: HeyGenVideoStatus;
  error?: string;
}

export interface HeyGenWebhookPayload {
  event_type: string;
  event_data: {
    video_id: string;
    status: string;
    url?: string;
    error?: string;
  };
}

function getApiKey(): string | null {
  return process.env.HEYGEN_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[heygen] ${message}`);
}

/**
 * Generate a personalized video using HeyGen
 */
export async function generatePersonalizedVideo(
  config: HeyGenConfig,
  recipientName: string,
  scriptText?: string,
): Promise<HeyGenVideoResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log("API key not configured (HEYGEN_API_KEY)");
    return { videoId: "", videoUrl: null, status: "failed", error: "API key not configured" };
  }

  if (!config.avatarId || !config.voiceId) {
    log("avatarId or voiceId not configured");
    return { videoId: "", videoUrl: null, status: "failed", error: "Avatar or voice not configured" };
  }

  // Use provided script or default template
  const defaultScript = `Hey {name}, great meeting you! I'm excited to connect with you about AI and automation.`;
  const script = (scriptText ?? config.scriptTemplate ?? defaultScript).replace(
    /\{name\}/g,
    recipientName,
  );

  try {
    const requestBody: Record<string, unknown> = {
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: config.avatarId,
            avatar_style: "normal",
          },
          voice: {
            type: "text",
            input_text: script,
            voice_id: config.voiceId,
          },
        },
      ],
      dimension: {
        width: 1280,
        height: 720,
      },
      test: false,
    };

    // Add webhook callback if configured
    // Use explicit webhookUrl from config, or construct from WEBHOOK_BASE_URL env var
    const webhookUrl = config.webhookUrl ||
      (process.env.WEBHOOK_BASE_URL ? `${process.env.WEBHOOK_BASE_URL}/webhooks/networking-event/heygen` : null);

    if (config.useWebhook && webhookUrl) {
      requestBody.callback_url = webhookUrl;
      log(`Using webhook URL: ${webhookUrl}`);
    } else if (config.useWebhook) {
      log("Warning: useWebhook is true but no webhookUrl or WEBHOOK_BASE_URL configured");
    }

    const endTimer = startTimer();
    const createResponse = await fetch(`${HEYGEN_API_BASE}/video/generate`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      log(`Video creation failed: ${createResponse.status} - ${errorText}`);
      recordIntegrationCall("heygen", "video_generate", "failure", endTimer());
      return { videoId: "", videoUrl: null, status: "failed", error: errorText };
    }
    recordIntegrationCall("heygen", "video_generate", "success", endTimer());

    const createData = (await createResponse.json()) as {
      data?: { video_id?: string };
      error?: { message?: string };
    };
    const videoId = createData.data?.video_id;

    if (!videoId) {
      log(`Video creation returned no video_id: ${JSON.stringify(createData)}`);
      return { videoId: "", videoUrl: null, status: "failed", error: "No video ID returned" };
    }

    log(`Video created with ID: ${videoId}`);

    // If using webhook, return immediately with pending status
    if (config.useWebhook) {
      return { videoId, videoUrl: null, status: "pending" };
    }

    // Otherwise, poll for completion
    return await pollVideoStatus(videoId, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    return { videoId: "", videoUrl: null, status: "failed", error: message };
  }
}

/**
 * Poll for video completion status
 */
async function pollVideoStatus(
  videoId: string,
  apiKey: string,
): Promise<HeyGenVideoResult> {
  log(`Polling for video ${videoId} completion...`);

  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = await getVideoStatus(videoId, apiKey);

    if (result.status === "completed" || result.status === "failed") {
      return result;
    }

    log(`Video ${videoId} status: ${result.status}`);
  }

  log(`Video ${videoId} timed out after ${POLL_TIMEOUT_MS}ms`);
  return { videoId, videoUrl: null, status: "pending" };
}

/**
 * Get video status (for manual checks or webhook verification)
 */
export async function getVideoStatus(
  videoId: string,
  apiKey?: string,
): Promise<HeyGenVideoResult> {
  const key = apiKey ?? getApiKey();
  if (!key) {
    return { videoId, videoUrl: null, status: "failed", error: "API key not configured" };
  }

  try {
    const endTimer = startTimer();
    // Note: video_status.get is a v1 endpoint, not v2
    const statusResponse = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
      {
        method: "GET",
        headers: { "X-Api-Key": key },
      },
    );

    if (!statusResponse.ok) {
      recordIntegrationCall("heygen", "video_status", "failure", endTimer());
      return { videoId, videoUrl: null, status: "failed", error: `Status check failed: ${statusResponse.status}` };
    }
    recordIntegrationCall("heygen", "video_status", "success", endTimer());

    const statusData = (await statusResponse.json()) as {
      data?: { status?: string; video_url?: string; error?: string };
    };

    const status = statusData.data?.status?.toLowerCase();

    if (status === "completed") {
      return {
        videoId,
        videoUrl: statusData.data?.video_url ?? null,
        status: "completed",
      };
    }

    if (status === "failed") {
      return {
        videoId,
        videoUrl: null,
        status: "failed",
        error: statusData.data?.error,
      };
    }

    return {
      videoId,
      videoUrl: null,
      status: status === "processing" ? "processing" : "pending",
    };
  } catch (error) {
    return {
      videoId,
      videoUrl: null,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse webhook payload from HeyGen
 */
export function parseWebhookPayload(
  body: unknown,
): HeyGenWebhookPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as Record<string, unknown>;

  if (
    typeof payload.event_type !== "string" ||
    !payload.event_data ||
    typeof payload.event_data !== "object"
  ) {
    return null;
  }

  const eventData = payload.event_data as Record<string, unknown>;

  return {
    event_type: payload.event_type,
    event_data: {
      video_id: String(eventData.video_id ?? ""),
      status: String(eventData.status ?? ""),
      url: eventData.url ? String(eventData.url) : undefined,
      error: eventData.error ? String(eventData.error) : undefined,
    },
  };
}

/**
 * List available avatars
 */
export async function listAvatars(): Promise<
  Array<{ avatar_id: string; avatar_name: string }>
> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${HEYGEN_API_BASE}/avatars`, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("heygen", "list_avatars", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      data?: { avatars?: Array<{ avatar_id: string; avatar_name: string }> };
    };

    recordIntegrationCall("heygen", "list_avatars", "success", endTimer());
    return data.data?.avatars ?? [];
  } catch {
    recordIntegrationCall("heygen", "list_avatars", "failure", endTimer());
    return [];
  }
}

/**
 * List available voices
 */
export async function listVoices(): Promise<
  Array<{ voice_id: string; name: string; language: string }>
> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${HEYGEN_API_BASE}/voices`, {
      method: "GET",
      headers: { "X-Api-Key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("heygen", "list_voices", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      data?: { voices?: Array<{ voice_id: string; name: string; language: string }> };
    };

    recordIntegrationCall("heygen", "list_voices", "success", endTimer());
    return data.data?.voices ?? [];
  } catch {
    recordIntegrationCall("heygen", "list_voices", "failure", endTimer());
    return [];
  }
}
