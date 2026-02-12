import type { HeyGenConfig, SupabaseConfig } from "../../config/types.js";
import {
  generatePersonalizedVideo,
  getVideoStatus,
} from "../../integrations/heygen/client.js";
import { updateHeyGenVideo } from "../../contacts/supabase-repo.js";

export interface HeyGenVideoParams {
  phoneNumber: string;
  recipientName: string;
  customScript?: string;
}

export interface HeyGenVideoResult {
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
}

/**
 * HeyGen video generation tool for AI agent
 *
 * Generates a personalized video for a contact using HeyGen.
 * If using webhooks, returns immediately with pending status.
 * Otherwise polls for completion.
 */
export async function heygenVideo(
  params: HeyGenVideoParams,
  heygenConfig: HeyGenConfig,
  supabaseConfig?: SupabaseConfig,
): Promise<HeyGenVideoResult> {
  if (!params.recipientName) {
    return {
      success: false,
      status: "failed",
      error: "recipientName is required",
    };
  }

  try {
    const result = await generatePersonalizedVideo(
      heygenConfig,
      params.recipientName,
      params.customScript,
    );

    // Save to database if we have video info
    if (result.videoId && params.phoneNumber) {
      try {
        await updateHeyGenVideo(
          params.phoneNumber,
          result.videoId,
          result.videoUrl,
          supabaseConfig,
        );
      } catch (error) {
        console.log(`[heygen-tool] Failed to save video info: ${error}`);
      }
    }

    return {
      success: result.status === "completed" || result.status === "pending",
      videoId: result.videoId || undefined,
      videoUrl: result.videoUrl ?? undefined,
      status: result.status,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check video status tool
 */
export async function checkVideoStatus(
  videoId: string,
): Promise<HeyGenVideoResult> {
  try {
    const result = await getVideoStatus(videoId);

    return {
      success: result.status === "completed",
      videoId: result.videoId,
      videoUrl: result.videoUrl ?? undefined,
      status: result.status,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tool definition for agent registration
 */
export const heygenVideoTool = {
  name: "heygen_video",
  description:
    "Generate a personalized video message for a contact using HeyGen AI avatar. The video will include a greeting with the recipient's name.",
  parameters: {
    type: "object",
    properties: {
      phoneNumber: {
        type: "string",
        description: "Phone number of the contact (for saving video info)",
      },
      recipientName: {
        type: "string",
        description: "Name of the recipient (used in video personalization)",
      },
      customScript: {
        type: "string",
        description:
          "Optional custom script for the video. Use {name} placeholder for recipient name.",
      },
    },
    required: ["phoneNumber", "recipientName"],
  },
};

/**
 * Tool definition for checking video status
 */
export const checkVideoStatusTool = {
  name: "check_video_status",
  description:
    "Check the status of a HeyGen video generation. Use this to poll for completion if the video was generated asynchronously.",
  parameters: {
    type: "object",
    properties: {
      videoId: {
        type: "string",
        description: "The HeyGen video ID to check",
      },
    },
    required: ["videoId"],
  },
};
