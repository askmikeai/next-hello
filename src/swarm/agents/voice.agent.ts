import { BaseAgent, type AgentConfig, registerAgentFactory } from "../base-agent.js";
import { defineTool } from "../llm/tool-executor.js";
import type { AgentContext, ToolDefinition, AgentType } from "../types.js";
import { generateVoiceMessage, listVoices } from "../../integrations/elevenlabs/client.js";
import { updateContactByPhone } from "../../contacts/index.js";
import { addJob } from "../../queue/client.js";
import type { OutboundMessageJob } from "../types.js";
import { createCorrelationId } from "../../observability/logger.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

/**
 * Voice Agent Configuration
 */
const AGENT_CONFIG: AgentConfig = {
  type: "voice",
  name: "Voice Agent",
  description: "Manages ElevenLabs voice message generation and delivery.",
  temperature: 0.3, // Low temperature for consistent operations
};

/**
 * VoiceAgent - Handles ElevenLabs voice message generation
 *
 * Responsibilities:
 * - Generate personalized voice messages using ElevenLabs TTS
 * - Save and queue voice messages for delivery
 * - Update contact records with voice message status
 * - Coordinate with personalization agent for scripts
 *
 * Tools:
 * - generate_voice_message: Generate a voice message from text
 * - list_available_voices: List available ElevenLabs voices
 * - send_voice_message: Queue voice message for delivery
 */
export class VoiceAgent extends BaseAgent {
  constructor() {
    super(AGENT_CONFIG);
  }

  /**
   * Get the system prompt for voice operations
   */
  protected getSystemPrompt(context: AgentContext): string {
    const elevenlabsConfigured = !!context.config.elevenlabs?.voiceId;

    return `You are a voice message generation agent for the networking follow-up system.

## Your Role
Generate personalized voice messages using ElevenLabs text-to-speech for outreach.

## ElevenLabs Status
${elevenlabsConfigured ? "ElevenLabs is configured and ready." : "Warning: ElevenLabs is not fully configured (missing voice ID)."}

## Voice Message Process
1. Receive a script (from personalization agent or template)
2. Generate audio using ElevenLabs TTS
3. Save audio file for delivery
4. Queue message for sending via WhatsApp
5. Update contact record with delivery status

## Best Practices
- Voice messages should be 15-45 seconds (50-150 words)
- Scripts should be conversational and natural
- Use the recipient's name for personalization
- Keep the tone warm and professional

## Current Contact
Phone: ${context.phoneNumber || "Unknown"}
Name: ${context.contact?.first_name || "Unknown"}
${context.contact?.swarm_metadata?.voiceMessageSent ? "Voice message already sent" : "No voice message sent yet"}`;
  }

  /**
   * Define tools available to this agent
   */
  protected getTools(): ToolDefinition[] {
    return [
      defineTool(
        "generate_voice_message",
        "Generate a voice message using ElevenLabs TTS",
        {
          phoneNumber: {
            type: "string",
            description: "Contact's phone number",
          },
          script: {
            type: "string",
            description: "Text script to convert to speech",
          },
          recipientName: {
            type: "string",
            description: "Recipient's name for personalization",
          },
        },
        ["phoneNumber", "script"]
      ),
      defineTool(
        "list_available_voices",
        "List available ElevenLabs voices",
        {},
        []
      ),
      defineTool(
        "send_voice_message",
        "Queue a generated voice message for delivery",
        {
          phoneNumber: {
            type: "string",
            description: "Contact's phone number",
          },
          audioPath: {
            type: "string",
            description: "Path to the audio file",
          },
        },
        ["phoneNumber", "audioPath"]
      ),
    ];
  }

  /**
   * Register tool handlers
   */
  protected registerTools(): void {
    // Generate voice message
    this.toolExecutor.registerTool(
      defineTool(
        "generate_voice_message",
        "Generate voice message",
        {
          phoneNumber: { type: "string" },
          script: { type: "string" },
          recipientName: { type: "string" },
        },
        ["phoneNumber", "script"]
      ),
      async (input, context) => {
        const elevenlabs = context.config.elevenlabs;
        if (!elevenlabs?.voiceId) {
          return { success: false, error: "ElevenLabs not configured (missing voice ID)" };
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return { success: false, error: "ELEVENLABS_API_KEY not set" };
        }

        try {
          const script = input.script as string;
          const recipientName = (input.recipientName as string) || context.contact?.first_name || "friend";
          const phoneNumber = input.phoneNumber as string;

          // Generate the voice message
          const result = await generateVoiceMessage(elevenlabs, script, recipientName);

          if (result.status !== "completed" || !result.audioData) {
            return {
              success: false,
              error: result.error || "Voice generation failed",
            };
          }

          // Save the audio file
          const mediaDir = process.env.MEDIA_DIR || "./data/media/voice";
          await mkdir(mediaDir, { recursive: true });

          const timestamp = Date.now();
          const filename = `voice_${phoneNumber.replace(/[^0-9]/g, "")}_${timestamp}.mp3`;
          const audioPath = join(mediaDir, filename);

          await writeFile(audioPath, result.audioData);

          context.logger.info(
            { phoneNumber, audioPath, size: result.audioData.length },
            "Voice message generated and saved"
          );

          // Update contact metadata
          await updateContactByPhone(
            phoneNumber,
            {
              swarm_metadata: {
                ...context.contact?.swarm_metadata,
                voiceMessageGenerated: true,
                voiceMessagePath: audioPath,
                voiceMessageGeneratedAt: new Date().toISOString(),
              },
            },
            context.config.supabase
          );

          return {
            success: true,
            audioPath,
            size: result.audioData.length,
            message: "Voice message generated successfully",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // List available voices
    this.toolExecutor.registerTool(
      defineTool(
        "list_available_voices",
        "List voices",
        {},
        []
      ),
      async () => {
        try {
          const voices = await listVoices();
          return {
            success: true,
            voices: voices.map(v => ({
              id: v.voice_id,
              name: v.name,
              category: v.category,
            })),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );

    // Send voice message
    this.toolExecutor.registerTool(
      defineTool(
        "send_voice_message",
        "Queue voice message",
        {
          phoneNumber: { type: "string" },
          audioPath: { type: "string" },
        },
        ["phoneNumber", "audioPath"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const audioPath = input.audioPath as string;

        try {
          // Queue the voice message for delivery
          const outboundJob: OutboundMessageJob = {
            correlationId: createCorrelationId(),
            phoneNumber,
            channel: context.channel || "whatsapp",
            messageType: "voice",
            content: audioPath,
            metadata: {
              contactId: context.contact?.id,
              generatedAt: new Date().toISOString(),
            },
          };

          await addJob("outbound-messages", outboundJob);

          // Update contact metadata
          await updateContactByPhone(
            phoneNumber,
            {
              swarm_metadata: {
                ...context.contact?.swarm_metadata,
                voiceMessageSent: true,
                voiceMessageSentAt: new Date().toISOString(),
              },
            },
            context.config.supabase
          );

          context.logger.info(
            { phoneNumber, audioPath },
            "Voice message queued for delivery"
          );

          return {
            success: true,
            message: "Voice message queued for delivery",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }
    );
  }

  /**
   * Determine if handoff to another agent is needed
   */
  protected determineNextAgent(): AgentType | undefined {
    // Voice is typically a leaf operation
    return undefined;
  }

  /**
   * Check if this agent can handle a given action
   */
  canHandle(action: string): boolean {
    const supportedActions = [
      "generate_voice",
      "generate_voice_message",
      "send_voice",
      "send_voice_message",
      "list_voices",
    ];
    return supportedActions.includes(action);
  }
}

// Register the factory for this agent
registerAgentFactory("voice", () => new VoiceAgent());

export default VoiceAgent;
