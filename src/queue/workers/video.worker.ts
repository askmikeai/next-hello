import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logError } from "../../observability/logger.js";
import { updateHeyGenVideo } from "../../contacts/supabase-repo.js";
import type { VideoGenerationJob } from "../../swarm/types.js";
import type { NetworkingEventConfig } from "../../config/types.js";

const logger = createWorkerLogger("video-worker");

/**
 * Video worker result
 */
export interface VideoWorkerResult {
  success: boolean;
  correlationId: string;
  contactId: string;
  videoId?: string;
  videoUrl?: string;
  error?: string;
}

/**
 * HeyGen video generation response
 */
interface HeyGenVideoResponse {
  data?: {
    video_id: string;
  };
  error?: string;
}

/**
 * HeyGen video status response
 */
interface HeyGenStatusResponse {
  data?: {
    status: "pending" | "processing" | "completed" | "failed";
    video_url?: string;
  };
  error?: string;
}

/**
 * Generate a HeyGen video
 */
async function generateHeyGenVideo(
  script: string,
  config: NetworkingEventConfig
): Promise<{ videoId?: string; error?: string }> {
  const apiKey = config.heygen?.apiKey || process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return { error: "HeyGen API key not configured" };
  }

  const avatarId = config.heygen?.avatarId;
  const voiceId = config.heygen?.voiceId;

  if (!avatarId || !voiceId) {
    return { error: "HeyGen avatar or voice ID not configured" };
  }

  try {
    const response = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {
              type: "avatar",
              avatar_id: avatarId,
            },
            voice: {
              type: "text",
              voice_id: voiceId,
              input_text: script,
            },
          },
        ],
        dimension: {
          width: 1280,
          height: 720,
        },
      }),
    });

    const data = (await response.json()) as HeyGenVideoResponse;

    if (!response.ok || data.error) {
      return { error: data.error || `HeyGen API error: ${response.status}` };
    }

    return { videoId: data.data?.video_id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Check HeyGen video status
 */
async function checkVideoStatus(
  videoId: string,
  config: NetworkingEventConfig
): Promise<{ status?: string; videoUrl?: string; error?: string }> {
  const apiKey = config.heygen?.apiKey || process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    return { error: "HeyGen API key not configured" };
  }

  try {
    const response = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
      {
        headers: {
          "X-Api-Key": apiKey,
        },
      }
    );

    const data = (await response.json()) as HeyGenStatusResponse;

    if (!response.ok || data.error) {
      return { error: data.error || `HeyGen API error: ${response.status}` };
    }

    return {
      status: data.data?.status,
      videoUrl: data.data?.video_url,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Build script from template
 */
function buildScript(template: string, variables: Record<string, string>): string {
  let script = template;

  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    script = script.replace(pattern, value);
  }

  return script;
}

/**
 * Wait for video to complete (with polling)
 */
async function waitForVideo(
  videoId: string,
  config: NetworkingEventConfig,
  maxWaitMs: number = 300000 // 5 minutes
): Promise<{ videoUrl?: string; error?: string }> {
  const startTime = Date.now();
  const pollIntervalMs = 10000; // 10 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const status = await checkVideoStatus(videoId, config);

    if (status.error) {
      return { error: status.error };
    }

    if (status.status === "completed" && status.videoUrl) {
      return { videoUrl: status.videoUrl };
    }

    if (status.status === "failed") {
      return { error: "Video generation failed" };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { error: "Video generation timed out" };
}

/**
 * Process a video generation job
 */
async function processVideoJob(
  job: Job<VideoGenerationJob>,
  config: NetworkingEventConfig
): Promise<VideoWorkerResult> {
  const { correlationId, contactId, phoneNumber, firstName, scriptTemplate, variables } =
    job.data;
  const jobLogger = logger.child({ correlationId, contactId, jobId: job.id });

  try {
    // Check if HeyGen is configured
    if (!config.heygen?.apiKey) {
      jobLogger.warn("HeyGen not configured, skipping video generation");
      return {
        success: false,
        correlationId,
        contactId,
        error: "HeyGen not configured",
      };
    }

    // Build the script
    const script = buildScript(scriptTemplate, {
      name: firstName,
      ...variables,
    });

    jobLogger.info({ scriptLength: script.length }, "Starting video generation");

    // Generate the video
    const generateResult = await generateHeyGenVideo(script, config);
    if (generateResult.error || !generateResult.videoId) {
      return {
        success: false,
        correlationId,
        contactId,
        error: generateResult.error || "Failed to start video generation",
      };
    }

    const videoId = generateResult.videoId;
    jobLogger.info({ videoId }, "Video generation started, waiting for completion");

    // Wait for completion
    const waitResult = await waitForVideo(videoId, config);
    if (waitResult.error || !waitResult.videoUrl) {
      return {
        success: false,
        correlationId,
        contactId,
        videoId,
        error: waitResult.error || "Video did not complete",
      };
    }

    // Update contact with video URL
    await updateHeyGenVideo(phoneNumber, videoId, waitResult.videoUrl, config.supabase);

    jobLogger.info({ videoId, videoUrl: waitResult.videoUrl }, "Video generation completed");

    return {
      success: true,
      correlationId,
      contactId,
      videoId,
      videoUrl: waitResult.videoUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(jobLogger, error as Error, "Video generation job failed");

    return {
      success: false,
      correlationId,
      contactId,
      error: errorMessage,
    };
  }
}

/**
 * Create the video worker
 */
export function createVideoWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<VideoGenerationJob, VideoWorkerResult> {
  const processor: JobProcessor<VideoGenerationJob, VideoWorkerResult> = async (job) => {
    return processVideoJob(job, config);
  };

  return createWorker<VideoGenerationJob, VideoWorkerResult>(
    "video-generation",
    processor,
    {
      concurrency: options?.concurrency ?? 2, // Low concurrency for video generation
      limiter: {
        max: 5,
        duration: 60000, // 5 videos per minute max
      },
      lockDuration: 600000, // 10 minute lock (videos take time)
    }
  );
}
