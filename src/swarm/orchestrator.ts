import type { Logger } from "pino";
import { createLogger, logAgentActivity, createCorrelationId } from "../observability/logger.js";
import { recordAgentExecution, activeAgents, startTimer } from "../observability/metrics.js";
import { getLLMClient } from "./llm/client.js";
import { ToolExecutor, defineTool } from "./llm/tool-executor.js";
import type {
  AgentType,
  AgentContext,
  AgentResult,
  AgentTask,
  SwarmState,
  Channel,
  ToolDefinition,
  OutboundMessageJob,
} from "./types.js";
import type { NetworkingContact, NetworkingEventConfig } from "../config/types.js";
import { getRedisConnection, addJob } from "../queue/client.js";
import { findContactByPhone, updateContactByPhone, deleteContactByPhone } from "../contacts/index.js";
import { getMissingRequiredFields } from "../contacts/state-machine.js";
import { buildSystemPrompt, buildContactContext } from "../agent/prompts.js";
import {
  ParallelTaskRunner,
  getParallelTaskRunner,
  createBackgroundTasks,
  createResearchPipeline,
  type ParallelExecutionResult,
  type BackgroundTaskOptions,
  type ResearchPipelineOptions,
} from "./parallel/index.js";
import { generateVoiceMessage } from "../integrations/elevenlabs/client.js";
import { getMediaStore } from "../storage/media-store.js";
import path from "path";

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  maxConversationTurns?: number;
  fallbackToRules?: boolean;
  defaultChannel?: Channel;
  stateExpirySecs?: number;
}

const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  maxConversationTurns: 20,
  fallbackToRules: true,
  defaultChannel: "whatsapp",
  stateExpirySecs: 86400, // 24 hours
};

/**
 * SwarmOrchestrator - Central AI brain for the multi-agent system
 *
 * The orchestrator uses Claude to:
 * - Analyze incoming messages
 * - Decide on the appropriate response
 * - Trigger actions (video generation, research, CRM sync)
 * - Maintain conversation context
 */
export class SwarmOrchestrator {
  private config: Required<OrchestratorConfig>;
  private logger: Logger;
  private toolExecutor: ToolExecutor;
  private parallelRunner: ParallelTaskRunner;

  constructor(
    private eventConfig: NetworkingEventConfig,
    orchestratorConfig?: OrchestratorConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...orchestratorConfig };
    this.logger = createLogger({ component: "orchestrator" });
    this.toolExecutor = new ToolExecutor();
    this.parallelRunner = getParallelTaskRunner();
    this.registerTools();
  }

  /**
   * Register all tools available to the orchestrator
   */
  private registerTools(): void {
    // Contact lookup tool
    this.toolExecutor.registerTool(
      defineTool(
        "contact_lookup",
        "Look up contact information by phone number. Returns contact details and missing required fields.",
        {
          phoneNumber: { type: "string", description: "Phone number in E.164 format" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const contact = await findContactByPhone(
          input.phoneNumber as string,
          context.config.supabase
        );
        if (!contact) {
          return { found: false, message: "Contact not found" };
        }
        const missing = getMissingRequiredFields(
          contact,
          context.config.requiredFields || ["email", "company_name", "job_title"]
        );
        return {
          found: true,
          contact: {
            firstName: contact.first_name,
            lastName: contact.last_name,
            email: contact.email,
            company: contact.company_name,
            jobTitle: contact.job_title,
            linkedinUrl: contact.linkedin_url,
            hasVideo: !!contact.heygen_video_url,
          },
          missingFields: missing,
        };
      }
    );

    // Contact update tool
    this.toolExecutor.registerTool(
      defineTool(
        "contact_update",
        "Update contact information. Use when the user provides their email, company, job title, LinkedIn, etc.",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          email: { type: "string", description: "Email address" },
          firstName: { type: "string", description: "First name" },
          lastName: { type: "string", description: "Last name" },
          companyName: { type: "string", description: "Company name" },
          jobTitle: { type: "string", description: "Job title" },
          linkedinUrl: { type: "string", description: "LinkedIn profile URL" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const updates: Record<string, string> = {};
        if (input.email) updates.email = input.email as string;
        if (input.firstName) updates.first_name = input.firstName as string;
        if (input.lastName) updates.last_name = input.lastName as string;
        if (input.companyName) updates.company_name = input.companyName as string;
        if (input.jobTitle) updates.job_title = input.jobTitle as string;
        if (input.linkedinUrl) updates.linkedin_url = input.linkedinUrl as string;

        const result = await updateContactByPhone(
          input.phoneNumber as string,
          updates,
          context.config.supabase
        );
        return result;
      }
    );

    // Calendly link tool
    this.toolExecutor.registerTool(
      defineTool(
        "get_calendly_link",
        "Get the Calendly scheduling link to share with the contact for booking a meeting.",
        {},
        []
      ),
      async (_, context) => {
        const link = context.config.calendly?.schedulingLink;
        if (!link) {
          return { error: "Calendly not configured" };
        }
        return { link };
      }
    );

    // Send video tool
    this.toolExecutor.registerTool(
      defineTool(
        "send_video",
        "Send the personalized video to the contact. Use when they ask for their video or you want to share it.",
        {
          phoneNumber: { type: "string", description: "Phone number to send video to" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const contact = await findContactByPhone(phoneNumber, context.config.supabase);

        if (!contact) {
          return { success: false, error: "Contact not found" };
        }

        if (!contact.heygen_video_url) {
          return {
            success: false,
            error: "No video available yet. Video may still be generating.",
            hasVideoId: !!contact.heygen_video_id,
          };
        }

        // Queue video for sending
        const outboundJob: OutboundMessageJob = {
          correlationId: createCorrelationId(),
          phoneNumber,
          channel: context.channel || "whatsapp",
          messageType: "video",
          content: contact.heygen_video_url,
          caption: `Hey ${contact.first_name || "there"}, here's your personalized video!`,
        };

        await addJob("outbound-messages", outboundJob);
        return { success: true, message: "Video queued for delivery" };
      }
    );

    // Generate video tool
    this.toolExecutor.registerTool(
      defineTool(
        "generate_video",
        "Generate a personalized HeyGen video for the contact. Use after collecting their info or when they're a good lead.",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          firstName: { type: "string", description: "First name for personalization" },
        },
        ["phoneNumber", "firstName"]
      ),
      async (input, context) => {
        const contact = await findContactByPhone(
          input.phoneNumber as string,
          context.config.supabase
        );

        if (contact?.heygen_video_url) {
          return { success: false, reason: "Video already exists for this contact" };
        }

        await addJob("video-generation", {
          correlationId: createCorrelationId(),
          contactId: contact?.id || "unknown",
          phoneNumber: input.phoneNumber as string,
          firstName: (input.firstName as string) || "there",
          scriptTemplate:
            "Hey {name}, it was great meeting you! I wanted to send you a personalized video. Looking forward to connecting!",
          variables: { name: (input.firstName as string) || "there" },
        });

        return { success: true, message: "Video generation queued" };
      }
    );

    // Research contact tool
    this.toolExecutor.registerTool(
      defineTool(
        "research_contact",
        "Trigger background research on the contact using their LinkedIn or company info.",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          linkedinUrl: { type: "string", description: "LinkedIn profile URL" },
          companyName: { type: "string", description: "Company name" },
        },
        ["phoneNumber"]
      ),
      async (input, context) => {
        const contact = await findContactByPhone(
          input.phoneNumber as string,
          context.config.supabase
        );

        await addJob("research-jobs", {
          correlationId: createCorrelationId(),
          contactId: contact?.id || "unknown",
          phoneNumber: input.phoneNumber as string,
          linkedinUrl: input.linkedinUrl as string | undefined,
          companyName: input.companyName as string | undefined,
          firstName: contact?.first_name,
          lastName: contact?.last_name,
        });

        return { success: true, message: "Research queued" };
      }
    );

    // Delete contact tool (GDPR)
    this.toolExecutor.registerTool(
      defineTool(
        "delete_contact",
        "Delete contact data from the system. Use when someone requests their data be deleted (GDPR).",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          confirmed: { type: "boolean", description: "Must be true to confirm deletion" },
        },
        ["phoneNumber", "confirmed"]
      ),
      async (input, context) => {
        if (!input.confirmed) {
          return { success: false, error: "Deletion not confirmed" };
        }
        const result = await deleteContactByPhone(
          input.phoneNumber as string,
          context.config.supabase
        );
        return result;
      }
    );

    // Trigger parallel tasks tool
    this.toolExecutor.registerTool(
      defineTool(
        "trigger_parallel_tasks",
        "Trigger multiple background tasks in parallel. Use to run research, CRM sync, and media generation concurrently without blocking the conversation.",
        {
          phoneNumber: { type: "string", description: "Phone number of the contact" },
          tasks: {
            type: "array",
            description: "Array of tasks to run: 'research', 'crm_sync', 'video', 'voice'",
          },
          firstName: { type: "string", description: "First name for video personalization" },
          voiceText: { type: "string", description: "Text for voice message generation" },
        },
        ["phoneNumber", "tasks"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const tasks = input.tasks as string[];
        const firstName = input.firstName as string | undefined;
        const voiceText = input.voiceText as string | undefined;

        const options: BackgroundTaskOptions = {
          research: tasks.includes("research"),
          crm: tasks.includes("crm_sync"),
          video: tasks.includes("video") && firstName ? { firstName } : undefined,
          voice: tasks.includes("voice") && voiceText ? { text: voiceText } : undefined,
        };

        try {
          await this.triggerBackgroundTasks(phoneNumber, context, options);
          return {
            success: true,
            message: `Triggered ${tasks.length} background tasks`,
            tasks,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to trigger tasks",
          };
        }
      }
    );

    // Enable/disable voice mode tool
    this.toolExecutor.registerTool(
      defineTool(
        "set_voice_mode",
        "Enable or disable voice response mode. When enabled, responses will be sent as voice messages instead of text.",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          enabled: { type: "boolean", description: "True to enable voice mode, false to disable" },
        },
        ["phoneNumber", "enabled"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const enabled = input.enabled as boolean;

        // Store voice mode preference in Redis
        const redis = getRedisConnection();
        if (redis) {
          const key = `voice_mode:${phoneNumber}`;
          if (enabled) {
            await redis.setex(key, 86400, "true"); // 24 hour expiry
          } else {
            await redis.del(key);
          }
        }

        return {
          success: true,
          voiceMode: enabled,
          message: enabled
            ? "Voice mode enabled. I'll respond with voice messages now."
            : "Voice mode disabled. I'll respond with text messages now.",
        };
      }
    );

    // Send voice response tool
    this.toolExecutor.registerTool(
      defineTool(
        "send_voice_response",
        "Send a voice message response using text-to-speech. Use this when voice mode is enabled or when the user explicitly asks for a voice response.",
        {
          phoneNumber: { type: "string", description: "Phone number to send voice to" },
          text: { type: "string", description: "Text to convert to speech and send" },
        },
        ["phoneNumber", "text"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const text = input.text as string;

        // Check if ElevenLabs is configured
        if (!context.config.elevenlabs?.voiceId) {
          return {
            success: false,
            error: "Voice generation not configured (missing ElevenLabs voice ID)",
          };
        }

        try {
          // Generate voice message
          const result = await generateVoiceMessage(
            context.config.elevenlabs,
            text,
            context.contact?.first_name ?? undefined
          );

          if (result.status !== "completed" || !result.audioData) {
            return {
              success: false,
              error: result.error || "Failed to generate voice message",
            };
          }

          // Save to media store
          const mediaStore = getMediaStore();
          const storeResult = await mediaStore.store({
            phoneNumber,
            contactId: context.contact?.id,
            mediaType: "voice",
            data: result.audioData,
            mimeType: "audio/ogg",
            source: "generated",
          });

          if (!storeResult.success || !storeResult.storageKey) {
            return {
              success: false,
              error: storeResult.error || "Failed to store voice message",
            };
          }

          const filePath = mediaStore.getLocalPath(storeResult.storageKey);

          // Queue voice message for sending
          const outboundJob: OutboundMessageJob = {
            correlationId: context.correlationId,
            phoneNumber,
            channel: context.channel || "whatsapp",
            messageType: "voice",
            content: filePath,
          };

          await addJob("outbound-messages", outboundJob);

          return {
            success: true,
            message: "Voice message queued for delivery",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to send voice message",
          };
        }
      }
    );
  }

  /**
   * Get tool definitions for Claude
   */
  private getTools(): ToolDefinition[] {
    return [
      defineTool(
        "contact_lookup",
        "Look up contact information by phone number",
        { phoneNumber: { type: "string", description: "Phone number" } },
        ["phoneNumber"]
      ),
      defineTool(
        "contact_update",
        "Update contact information (email, name, company, job title, LinkedIn)",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          email: { type: "string", description: "Email address" },
          firstName: { type: "string", description: "First name" },
          lastName: { type: "string", description: "Last name" },
          companyName: { type: "string", description: "Company name" },
          jobTitle: { type: "string", description: "Job title" },
          linkedinUrl: { type: "string", description: "LinkedIn URL" },
        },
        ["phoneNumber"]
      ),
      defineTool(
        "get_calendly_link",
        "Get the scheduling link to share with the contact",
        {},
        []
      ),
      defineTool(
        "send_video",
        "Send the personalized video to the contact",
        { phoneNumber: { type: "string", description: "Phone number" } },
        ["phoneNumber"]
      ),
      defineTool(
        "generate_video",
        "Generate a personalized video for the contact",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          firstName: { type: "string", description: "First name" },
        },
        ["phoneNumber", "firstName"]
      ),
      defineTool(
        "research_contact",
        "Research the contact's background using LinkedIn or company info",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          linkedinUrl: { type: "string", description: "LinkedIn URL" },
          companyName: { type: "string", description: "Company name" },
        },
        ["phoneNumber"]
      ),
      defineTool(
        "delete_contact",
        "Delete contact data (GDPR compliance)",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          confirmed: { type: "boolean", description: "Confirm deletion" },
        },
        ["phoneNumber", "confirmed"]
      ),
      defineTool(
        "trigger_parallel_tasks",
        "Trigger multiple background tasks in parallel (research, CRM sync, video, voice)",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          tasks: { type: "array", description: "Tasks: 'research', 'crm_sync', 'video', 'voice'" },
          firstName: { type: "string", description: "First name for video" },
          voiceText: { type: "string", description: "Text for voice message" },
        },
        ["phoneNumber", "tasks"]
      ),
      defineTool(
        "set_voice_mode",
        "Enable or disable voice response mode for this conversation",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          enabled: { type: "boolean", description: "True to enable, false to disable" },
        },
        ["phoneNumber", "enabled"]
      ),
      defineTool(
        "send_voice_response",
        "Send a voice message response using text-to-speech",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          text: { type: "string", description: "Text to speak" },
        },
        ["phoneNumber", "text"]
      ),
    ];
  }

  /**
   * Build the system prompt for the orchestrator
   */
  private buildSystemPrompt(context: AgentContext, state: SwarmState, voiceModeEnabled: boolean): string {
    const basePrompt = buildSystemPrompt(this.eventConfig);
    const contactContext = buildContactContext(
      context.contact || null,
      this.eventConfig.requiredFields || ["email", "company_name", "job_title"]
    );

    const voiceModeInstructions = voiceModeEnabled
      ? `
## Voice Mode: ENABLED (user sent voice message)
The user is communicating via voice. You MUST use the send_voice_response tool for ALL your responses.
- Keep voice responses conversational and concise (under 30 seconds)
- If user asks for "text", "write to me", "type", or wants text responses, disable voice mode with set_voice_mode(enabled=false) and respond with text
- Otherwise, ALWAYS respond with voice messages`
      : `
## Voice Mode: DISABLED
Respond with text messages.
- If the user sends a voice message, voice mode will auto-enable
- You can also enable voice mode with set_voice_mode if they ask for it`;

    return `${basePrompt}

${contactContext}

## Your Role
You are the AI orchestrator for ${this.eventConfig.ownerName}'s networking assistant. You handle all conversations and decide what actions to take.

## Current Context
- Phone: ${context.phoneNumber}
- Channel: ${context.channel || "whatsapp"}
- Conversation turns: ${state.conversationTurns}
${voiceModeInstructions}

## Available Actions
1. **Respond conversationally** - Answer questions, collect info, be helpful
2. **Update contact info** - When they share email, company, LinkedIn, etc.
3. **Send video** - When they ask for their video or you want to share it
4. **Generate video** - After collecting info from a promising lead
5. **Research** - When you have LinkedIn or company info to look up
6. **Schedule meeting** - Share the Calendly link when appropriate
7. **Trigger parallel tasks** - Run multiple background tasks at once (research + CRM + video)
8. **Voice mode** - Enable/disable voice responses, send voice messages

## Guidelines
- Be friendly and conversational, not robotic
- Collect required info naturally (email, company, job title)
- After collecting info, use trigger_parallel_tasks to run research, CRM sync, and video generation in parallel
- If they share LinkedIn, trigger research
- If they ask about scheduling, share the Calendly link
- If they ask to delete their data, confirm and delete
- Use parallel tasks to respond quickly while background work happens
- If the user asks to "talk", "chat by voice", "send voice notes", or similar - enable voice mode and respond with voice

Respond directly to the user. Use tools when you need to take actions.`;
  }

  /**
   * Process an incoming message - THE MAIN ENTRY POINT
   */
  async processMessage(
    phoneNumber: string,
    message: string,
    channel: Channel = this.config.defaultChannel,
    contact?: NetworkingContact,
    options?: {
      isVoiceMessage?: boolean;
    }
  ): Promise<AgentResult> {
    const correlationId = createCorrelationId();
    const logger = this.logger.child({ correlationId, phoneNumber });
    const endTimer = startTimer();

    activeAgents.inc({ agent_type: "orchestrator" });

    logAgentActivity(logger, {
      agentType: "orchestrator",
      action: "process_message",
      status: "started",
      contactId: contact?.id,
    });

    try {
      // Load or create swarm state
      const state = await this.loadOrCreateState(correlationId, phoneNumber, channel);

      // Build context
      const context: AgentContext = {
        correlationId,
        config: this.eventConfig,
        contact,
        phoneNumber,
        channel,
        logger,
      };

      // Determine voice mode
      // - Auto-enable if user sends a voice message
      // - Check Redis for existing preference
      let voiceModeEnabled = false;
      const redis = getRedisConnection();

      if (options?.isVoiceMessage) {
        // User sent a voice message - auto-enable voice mode
        voiceModeEnabled = true;
        if (redis) {
          try {
            await redis.set(`voice_mode:${phoneNumber}`, "true", "EX", 86400); // 24 hour TTL
            logger.info({ phoneNumber }, "Voice mode auto-enabled (user sent voice message)");
          } catch {
            // Ignore Redis errors
          }
        }
      } else if (redis) {
        try {
          const voiceMode = await redis.get(`voice_mode:${phoneNumber}`);
          voiceModeEnabled = voiceMode === "true";
        } catch {
          // Ignore Redis errors
        }
      }

      // Get LLM client
      const llm = getLLMClient();

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(context, state, voiceModeEnabled);

      // Call Claude with tools
      const response = await llm.runWithTools(
        {
          systemPrompt,
          messages: [{ role: "user", content: message }],
          tools: this.getTools(),
          temperature: 0.7,
        },
        async (toolCall) => {
          logger.info({ tool: toolCall.name, input: toolCall.input }, "Executing tool");
          const result = await this.toolExecutor.executeTool(toolCall, context);
          return JSON.stringify(result.result);
        }
      );

      // Update state
      state.conversationTurns += 1;
      state.lastActivityAt = new Date();
      state.currentAgent = "orchestrator";
      await this.saveState(state);

      logAgentActivity(logger, {
        agentType: "orchestrator",
        action: "process_message",
        status: "completed",
        contactId: contact?.id,
      });

      recordAgentExecution("orchestrator", "process_message", "success", endTimer());
      activeAgents.dec({ agent_type: "orchestrator" });

      return {
        success: true,
        agentType: "orchestrator",
        response: response.content,
        tokensUsed: {
          input: response.usage.inputTokens,
          output: response.usage.outputTokens,
        },
        toolCalls: response.toolCalls,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      logAgentActivity(logger, {
        agentType: "orchestrator",
        action: "process_message",
        status: "failed",
        contactId: contact?.id,
        error: errorMessage,
      });

      recordAgentExecution("orchestrator", "process_message", "failure", endTimer());
      activeAgents.dec({ agent_type: "orchestrator" });

      logger.error({ error: errorMessage }, "Orchestrator failed");

      // Return error result
      return {
        success: false,
        agentType: "orchestrator",
        error: errorMessage,
      };
    }
  }

  /**
   * Load or create swarm state from Redis
   */
  private async loadOrCreateState(
    correlationId: string,
    phoneNumber: string,
    channel: Channel
  ): Promise<SwarmState> {
    const redis = getRedisConnection();
    const key = `swarm:state:${phoneNumber}`;

    if (redis) {
      try {
        const existing = await redis.get(key);
        if (existing) {
          const state = JSON.parse(existing) as SwarmState;
          state.correlationId = correlationId; // Update correlation ID
          state.lastActivityAt = new Date();
          return state;
        }
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, "Failed to load state from Redis");
      }
    }

    // Create new state
    return {
      correlationId,
      phoneNumber,
      channel,
      taskQueue: [],
      completedTasks: [],
      conversationTurns: 0,
      lastActivityAt: new Date(),
    };
  }

  /**
   * Save swarm state to Redis
   */
  private async saveState(state: SwarmState): Promise<void> {
    const redis = getRedisConnection();
    const key = `swarm:state:${state.phoneNumber}`;

    if (redis) {
      try {
        await redis.setex(key, this.config.stateExpirySecs, JSON.stringify(state));
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, "Failed to save state to Redis");
      }
    }
  }

  /**
   * Trigger background tasks in parallel (fire-and-forget)
   * Use this to run research, CRM sync, and media generation without blocking
   */
  async triggerBackgroundTasks(
    phoneNumber: string,
    context: AgentContext,
    options: BackgroundTaskOptions
  ): Promise<void> {
    const group = createBackgroundTasks(context.correlationId, phoneNumber, options);

    this.logger.info(
      {
        correlationId: context.correlationId,
        phoneNumber,
        taskCount: group.tasks.length,
        tasks: group.tasks.map((t) => t.agentType),
      },
      "Triggering background tasks"
    );

    await this.parallelRunner.execute(group, context);
  }

  /**
   * Run a research pipeline with dependencies (research → qualification)
   * Waits for all tasks to complete and returns merged results
   */
  async runResearchPipeline(
    phoneNumber: string,
    context: AgentContext,
    options?: ResearchPipelineOptions
  ): Promise<ParallelExecutionResult> {
    const group = createResearchPipeline(context.correlationId, phoneNumber, {
      linkedinUrl: options?.linkedinUrl,
      companyName: options?.companyName,
      skipQualification: options?.skipQualification,
    });

    if (options?.timeoutMs) {
      group.timeout = options.timeoutMs;
    }

    this.logger.info(
      {
        correlationId: context.correlationId,
        phoneNumber,
        taskCount: group.tasks.length,
        linkedinUrl: options?.linkedinUrl,
      },
      "Running research pipeline"
    );

    return this.parallelRunner.execute(group, context);
  }

  /**
   * Check if orchestrator is operational
   */
  isOperational(): boolean {
    try {
      getLLMClient();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available agent types (for compatibility)
   */
  getAvailableAgents(): AgentType[] {
    return ["orchestrator"];
  }
}

// Singleton orchestrator instance
let instance: SwarmOrchestrator | null = null;

/**
 * Get or create the orchestrator instance
 */
export function getOrchestrator(
  eventConfig?: NetworkingEventConfig,
  orchestratorConfig?: OrchestratorConfig
): SwarmOrchestrator {
  if (!instance) {
    if (!eventConfig) {
      throw new Error("Event config required to initialize orchestrator");
    }
    instance = new SwarmOrchestrator(eventConfig, orchestratorConfig);
  }
  return instance;
}

/**
 * Reset the orchestrator (for testing)
 */
export function resetOrchestrator(): void {
  instance = null;
}
