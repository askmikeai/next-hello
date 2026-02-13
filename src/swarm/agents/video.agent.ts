import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { updateHeyGenVideo } from "../../contacts/index.js";

/**
 * Video Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "video",
  name: "Video Agent",
  description: "Manages HeyGen video generation and coordination.",
  temperature: 0.3, // Low temperature for consistent operations
};

/**
 * VideoAgent - Handles HeyGen video generation
 *
 * Responsibilities:
 * - Initiate video generation requests
 * - Check video generation status
 * - Update contact records with video URLs
 * - Coordinate with personalization agent for scripts
 *
 * Tools:
 * - generate_video: Start HeyGen video generation
 * - check_video_status: Check generation status
 * - get_video_url: Get completed video URL
 */
export class VideoAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for video operations
   */
  protected getSystemPrompt(context: AgentContext): string {
    const heygenConfigured = !!context.config.heygen?.avatarId;

    return `You are a video generation agent for the networking follow-up system.

## Your Role
Coordinate HeyGen video generation for personalized outreach.

## HeyGen Status
${heygenConfigured ? "HeyGen is configured and ready." : "Warning: HeyGen is not fully configured (missing avatar/voice ID)."}

## Video Generation Process
1. Receive a script (from personalization agent or template)
2. Submit to HeyGen for video generation
3. Monitor generation status
4. Update contact record when complete
5. Notify that video is ready for sending

## Best Practices
- Videos should be 30-60 seconds max
- Scripts should be conversational, not robotic
- Always check if contact already has a video before generating
- Handle generation failures gracefully

## Current Contact
Phone: ${context.phoneNumber || "Unknown"}
${context.contact?.heygen_video_id ? `Existing video ID: ${context.contact.heygen_video_id}` : "No existing video"}
${context.contact?.heygen_video_url ? `Video URL: ${context.contact.heygen_video_url}` : ""}`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "generate_heygen_video",
        "Start generating a HeyGen video with the given script",
        {
          phoneNumber: {
            type: "string",
            description: "Contact's phone number",
          },
          script: {
            type: "string",
            description: "Video script to use",
          },
          webhookUrl: {
            type: "string",
            description: "Optional webhook URL for completion notification",
          },
        },
        ["phoneNumber", "script"]
      ),
      defineTool(
        "check_video_status",
        "Check the status of a HeyGen video generation",
        {
          videoId: {
            type: "string",
            description: "HeyGen video ID",
          },
        },
        ["videoId"]
      ),
      defineTool(
        "get_contact_video",
        "Get the video information for a contact",
        {
          phoneNumber: {
            type: "string",
            description: "Contact's phone number",
          },
        },
        ["phoneNumber"]
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // Generate HeyGen video
    this.toolExecutor.registerTool(
      defineTool(
        "generate_heygen_video",
        "Generate video",
        {
          phoneNumber: { type: "string" },
          script: { type: "string" },
          webhookUrl: { type: "string" },
        },
        ["phoneNumber", "script"]
      ),
      async (input, context) => {
        const heygen = context.config.heygen;
        if (!heygen?.avatarId || !heygen?.voiceId) {
          return { success: false, error: "HeyGen not configured (missing avatar/voice ID)" };
        }

        const apiKey = process.env.HEYGEN_API_KEY;
        if (!apiKey) {
          return { success: false, error: "HEYGEN_API_KEY not set" };
        }

        try {
          // Build request body with optional webhook callback
          const requestBody: Record<string, unknown> = {
            video_inputs: [
              {
                character: {
                  type: "avatar",
                  avatar_id: heygen.avatarId,
                  avatar_style: "normal",
                },
                voice: {
                  type: "text",
                  voice_id: heygen.voiceId,
                  input_text: input.script as string,
                },
              },
            ],
            dimension: {
              width: 1280,
              height: 720,
            },
            callback_id: input.phoneNumber as string,
          };

          // Add webhook URL if configured - this is essential for automatic video delivery
          // Use explicit webhookUrl from config, or construct from WEBHOOK_BASE_URL env var
          const webhookUrl = heygen.webhookUrl ||
            (process.env.WEBHOOK_BASE_URL ? `${process.env.WEBHOOK_BASE_URL}/webhooks/networking-event/heygen` : null);

          if (webhookUrl) {
            requestBody.callback_url = webhookUrl;
            context.logger.debug({ webhookUrl }, "Webhook URL configured for video callback");
          } else {
            context.logger.warn("No webhook URL configured (set heygen.webhookUrl or WEBHOOK_BASE_URL) - video will not be sent automatically");
          }

          const response = await fetch("https://api.heygen.com/v2/video/generate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": apiKey,
            },
            body: JSON.stringify(requestBody),
          });

          const data = await response.json() as { data?: { video_id: string }; error?: string };

          if (!response.ok || data.error) {
            return {
              success: false,
              error: data.error || `HeyGen API error: ${response.status}`,
            };
          }

          const videoId = data.data?.video_id;

          // Save video_id to contact record so webhook can find them when video is ready
          if (videoId) {
            await updateHeyGenVideo(
              input.phoneNumber as string,
              videoId,
              null, // URL will be set by webhook when video is complete
              context.config.supabase
            );
            context.logger.info(
              { phoneNumber: input.phoneNumber, videoId },
              "Video ID saved to contact - video will be sent automatically when ready"
            );
          }

          return {
            success: true,
            videoId,
            status: "processing",
            message: "Video generation started - will be sent automatically when ready",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Check video status
    this.toolExecutor.registerTool(
      defineTool(
        "check_video_status",
        "Check status",
        { videoId: { type: "string" } },
        ["videoId"]
      ),
      async (input, context) => {
        const apiKey = process.env.HEYGEN_API_KEY;
        if (!apiKey) {
          return { success: false, error: "HEYGEN_API_KEY not set" };
        }

        try {
          const response = await fetch(
            `https://api.heygen.com/v1/video_status.get?video_id=${input.videoId}`,
            {
              headers: { "X-Api-Key": apiKey },
            }
          );

          const data = await response.json() as {
            data?: { status: string; video_url?: string };
            error?: string;
          };

          if (!response.ok || data.error) {
            return {
              success: false,
              error: data.error || `HeyGen API error: ${response.status}`,
            };
          }

          const status = data.data?.status;
          const videoUrl = data.data?.video_url;

          // If completed, update contact record
          if (status === "completed" && videoUrl && context.phoneNumber) {
            await updateHeyGenVideo(
              context.phoneNumber,
              input.videoId as string,
              videoUrl,
              context.config.supabase
            );
          }

          return {
            success: true,
            status,
            videoUrl,
            completed: status === "completed",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Get contact video
    this.toolExecutor.registerTool(
      defineTool(
        "get_contact_video",
        "Get video info",
        { phoneNumber: { type: "string" } },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const contact = context.contact;

        if (!contact) {
          return { found: false, error: "Contact not found" };
        }

        return {
          found: true,
          hasVideo: !!contact.heygen_video_id,
          videoId: contact.heygen_video_id,
          videoUrl: contact.heygen_video_url,
        };
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // Video is typically a leaf operation
    return undefined;
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "generate_video",
      "check_video_status",
      "get_video",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("video", () => new VideoAgent());

export default VideoAgent;
