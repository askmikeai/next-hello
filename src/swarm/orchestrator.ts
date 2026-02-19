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
  RecentAgentResult,
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
import { getMessageStore } from "../history/message-store.js";
import { getMediaStore } from "../storage/media-store.js";
import {
  getAvailableTimes,
  createSingleUseSchedulingLink,
  formatAvailableTimes,
  listEventTypes,
} from "../integrations/calendly/client.js";
import path from "path";

// Dynamic orchestration imports
import {
  getStrategyToolDefinition,
  createStrategyToolHandler,
} from "./tools/strategy.tool.js";
import {
  getInvokeAgentsToolDefinition,
  createInvokeAgentsToolHandler,
} from "./tools/invoke-agents.tool.js";
import {
  getWaitForAgentToolDefinition,
  createWaitForAgentToolHandler,
  setAgentState,
} from "./tools/wait-for-agent.tool.js";
import {
  buildAgentReasoningPrompt,
  buildAgentResultsContext,
} from "./prompts/agent-reasoning.js";

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  maxConversationTurns?: number;
  fallbackToRules?: boolean;
  defaultChannel?: Channel;
  stateExpirySecs?: number;
  /** Enable dynamic orchestration features */
  dynamicOrchestration?: {
    enabled?: boolean;
    enableAgentSelection?: boolean;
    enableDynamicDependencies?: boolean;
    enableResultAwareness?: boolean;
  };
}

const DEFAULT_CONFIG: Required<OrchestratorConfig> = {
  maxConversationTurns: 20,
  fallbackToRules: true,
  defaultChannel: "whatsapp",
  stateExpirySecs: 86400, // 24 hours
  dynamicOrchestration: {
    enabled: true,
    enableAgentSelection: true,
    enableDynamicDependencies: true,
    enableResultAwareness: true,
  },
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

    // Send text message tool (for when you need to send text even in voice mode)
    this.toolExecutor.registerTool(
      defineTool(
        "send_text_message",
        "Send a text message to the user. Use this for lists, links, times, or any structured info that should be readable. Works even when voice mode is enabled.",
        {
          phoneNumber: { type: "string", description: "Phone number to send to" },
          text: { type: "string", description: "Text message content" },
        },
        ["phoneNumber", "text"]
      ),
      async (input, context) => {
        const phoneNumber = input.phoneNumber as string;
        const text = input.text as string;

        const outboundJob: OutboundMessageJob = {
          correlationId: context.correlationId,
          phoneNumber,
          channel: context.channel || "whatsapp",
          messageType: "text",
          content: text,
        };

        await addJob("outbound-messages", outboundJob);
        return { success: true, message: "Text message queued for delivery" };
      }
    );

    // Get available meeting times tool
    this.toolExecutor.registerTool(
      defineTool(
        "get_available_times",
        "Get available meeting times from Calendly for the next few days. Use when the user wants to schedule a meeting and you need to show them available slots.",
        {
          daysAhead: { type: "number", description: "Number of days ahead to check (default: 5)" },
          maxSlots: { type: "number", description: "Maximum number of slots to show (default: 5)" },
        },
        []
      ),
      async (input, context) => {
        const daysAhead = (input.daysAhead as number) || 5;
        const maxSlots = (input.maxSlots as number) || 5;

        // Get event types first
        const eventTypes = await listEventTypes(context.config.calendly || {});
        if (!eventTypes.length) {
          return {
            success: false,
            error: "No Calendly event types available",
          };
        }

        // Use the first active event type
        const eventType = eventTypes[0];

        // Calculate date range
        const startTime = new Date().toISOString();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + daysAhead);
        const endTime = endDate.toISOString();

        // Get available times
        const times = await getAvailableTimes(eventType.uri, startTime, endTime);

        if (!times.length) {
          return {
            success: false,
            error: "No available times found for the requested period",
          };
        }

        // Format times for display
        const formattedTimes = formatAvailableTimes(times, "America/New_York", maxSlots);
        const availableSlots = times
          .filter((t) => t.status === "available")
          .slice(0, maxSlots)
          .map((t, i) => ({
            option: i + 1,
            startTime: t.startTime,
            endTime: t.endTime,
          }));

        // Store the scheduling context in Redis for when user selects a time
        const redis = getRedisConnection();
        if (redis) {
          const schedulingContext = {
            eventTypeUri: eventType.uri,
            eventTypeName: eventType.name,
            duration: eventType.duration,
            availableSlots,
            createdAt: new Date().toISOString(),
          };
          await redis.setex(
            `scheduling:${context.phoneNumber}`,
            3600, // 1 hour expiry
            JSON.stringify(schedulingContext)
          );
        }

        return {
          success: true,
          eventTypeName: eventType.name,
          eventTypeUri: eventType.uri,
          duration: eventType.duration,
          availableSlots,
          formattedTimesForUser: formattedTimes,
          instructions: "CRITICAL: Include the formattedTimesForUser DIRECTLY in your response text. Do NOT use send_text_message tool - just put the times in your response. Example: 'Here are some available times:\\n\\n' + formattedTimesForUser + '\\n\\nJust reply with the number that works!'",
        };
      }
    );

    // Create booking link tool
    this.toolExecutor.registerTool(
      defineTool(
        "create_booking_link",
        "Create a single-use booking link. REQUIRED: You MUST pass the selectedOption parameter with the number the user chose (1, 2, 3, etc.).",
        {
          selectedOption: { type: "number", description: "REQUIRED: The exact number the user selected (1, 2, 3, etc.). If user says '3', pass 3." },
        },
        ["selectedOption"] // Make it required
      ),
      async (input, context) => {
        let eventTypeUri: string | undefined;
        let selectedSlot: { option: number; startTime: string; endTime: string } | undefined;
        let eventTypeName: string | undefined;

        // Try to get scheduling context from Redis
        const redis = getRedisConnection();
        if (redis) {
          try {
            const schedulingContextStr = await redis.get(`scheduling:${context.phoneNumber}`);
            if (schedulingContextStr) {
              const schedulingContext = JSON.parse(schedulingContextStr);
              eventTypeUri = schedulingContext.eventTypeUri;
              eventTypeName = schedulingContext.eventTypeName;
              const availableSlots = schedulingContext.availableSlots || [];

              // Determine selected option - use input if provided, otherwise parse from context
              let selectedOptionNum = input.selectedOption ? Number(input.selectedOption) : 0;

              // If AI didn't pass the option, try to parse from the last user message
              if (!selectedOptionNum && context.lastUserMessage) {
                const userMsg = context.lastUserMessage.trim();
                // Check for number at start of message (e.g., "3", "3.", "3 please", "3\nMy email is...")
                const numberMatch = userMsg.match(/^(\d)(?:[\s.\n]|$)/);
                if (numberMatch) {
                  selectedOptionNum = parseInt(numberMatch[1], 10);
                } else {
                  // Check for "option X" or "number X" patterns
                  const optionMatch = userMsg.match(/(?:option|number|#)\s*(\d)/i);
                  if (optionMatch) {
                    selectedOptionNum = parseInt(optionMatch[1], 10);
                  } else {
                    // Check for ordinal words
                    const ordinals: Record<string, number> = {
                      'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
                      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
                      '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5,
                    };
                    const lowerMsg = userMsg.toLowerCase();
                    for (const [word, num] of Object.entries(ordinals)) {
                      if (lowerMsg.includes(word)) {
                        selectedOptionNum = num;
                        break;
                      }
                    }
                  }
                }
              }

              // Default to first option only if we couldn't parse anything
              if (!selectedOptionNum || selectedOptionNum < 1 || selectedOptionNum > availableSlots.length) {
                selectedOptionNum = 1;
              }

              selectedSlot = availableSlots.find((s: { option: number }) => s.option === selectedOptionNum);
            }
          } catch {
            // Ignore Redis errors
          }
        }

        // If not in Redis, try to get from input or fetch fresh
        if (!eventTypeUri && input.eventTypeUri) {
          eventTypeUri = input.eventTypeUri as string;
        }

        // Last resort: fetch the first event type from Calendly
        if (!eventTypeUri) {
          const eventTypes = await listEventTypes(context.config.calendly || {});
          if (eventTypes.length > 0) {
            eventTypeUri = eventTypes[0].uri;
          }
        }

        if (!eventTypeUri) {
          return {
            success: false,
            error: "No event type available. Please try get_available_times first.",
          };
        }

        const result = await createSingleUseSchedulingLink(eventTypeUri);

        if (!result) {
          return {
            success: false,
            error: "Failed to create booking link",
          };
        }

        // Clear the scheduling context after successful booking link creation
        if (redis) {
          await redis.del(`scheduling:${context.phoneNumber}`);
        }

        // Format the selected time for confirmation
        let formattedSelectedTime = "";
        if (selectedSlot) {
          const startDate = new Date(selectedSlot.startTime);
          formattedSelectedTime = startDate.toLocaleString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/New_York",
          });
        }

        return {
          success: true,
          bookingUrl: result.bookingUrl,
          selectedTime: formattedSelectedTime || "the selected time",
          eventTypeName: eventTypeName || "meeting",
          instructions: `IMPORTANT: When confirming, use EXACTLY this time: "${formattedSelectedTime}". Include the bookingUrl directly in your response. Do NOT guess or change the date/time.`,
        };
      }
    );

    // Register dynamic orchestration tools
    this.registerDynamicOrchestrationTools();
  }

  /**
   * Register dynamic orchestration tools (decide_strategy, invoke_agents, wait_for_agent)
   */
  private registerDynamicOrchestrationTools(): void {
    const dynamicConfig = this.config.dynamicOrchestration;

    // Skip if dynamic orchestration is disabled
    if (!dynamicConfig?.enabled) {
      this.logger.info("Dynamic orchestration disabled - skipping tool registration");
      return;
    }

    this.logger.info("Registering dynamic orchestration tools");

    // decide_strategy tool
    this.toolExecutor.registerTool(
      getStrategyToolDefinition(),
      createStrategyToolHandler()
    );

    // invoke_agents tool (only if agent selection enabled)
    if (dynamicConfig.enableAgentSelection) {
      this.toolExecutor.registerTool(
        getInvokeAgentsToolDefinition(),
        createInvokeAgentsToolHandler()
      );
    }

    // wait_for_agent tool (only if result awareness enabled)
    if (dynamicConfig.enableResultAwareness) {
      this.toolExecutor.registerTool(
        getWaitForAgentToolDefinition(),
        createWaitForAgentToolHandler()
      );
    }
  }

  /**
   * Get tool definitions for Claude
   */
  private getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
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
      defineTool(
        "send_text_message",
        "Send a text message. Use for lists, links, times, or structured info even when in voice mode.",
        {
          phoneNumber: { type: "string", description: "Phone number" },
          text: { type: "string", description: "Text message content" },
        },
        ["phoneNumber", "text"]
      ),
      defineTool(
        "get_available_times",
        "Get available meeting times from Calendly. Returns formatted times that MUST be sent as text (not voice).",
        {
          daysAhead: { type: "number", description: "Days ahead to check (default: 5)" },
          maxSlots: { type: "number", description: "Max slots to show (default: 5)" },
        },
        []
      ),
      defineTool(
        "create_booking_link",
        "Create a single-use booking link. Call when user selects a time (says '1', '2', 'first one', etc.). No params needed.",
        {},
        []
      ),
    ];

    // Add dynamic orchestration tools if enabled
    const dynamicConfig = this.config.dynamicOrchestration;
    if (dynamicConfig?.enabled) {
      tools.push(getStrategyToolDefinition());

      if (dynamicConfig.enableAgentSelection) {
        tools.push(getInvokeAgentsToolDefinition());
      }

      if (dynamicConfig.enableResultAwareness) {
        tools.push(getWaitForAgentToolDefinition());
      }
    }

    return tools;
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
The user is communicating via voice. Use send_voice_response for conversational responses, but be SMART about when text is better.

### USE VOICE for:
- Greetings and friendly responses
- Short answers and confirmations
- Conversational back-and-forth
- Emotional or personal messages
- Anything under ~50 words that sounds natural spoken

### USE TEXT for (even if user asked via voice):
- URLs, links, or scheduling links (e.g., Calendly) - ALWAYS send links as text
- Lists with more than 3 items
- Technical details, code, or structured data
- Long explanations (over 50 words) - summarize in voice, then send details as text
- Contact info (emails, phone numbers)
- Anything the user would want to copy/paste

### Best Practice:
You can combine both! Send a short friendly voice message, then follow up with text containing links/details.
Example: Voice: "Great question! I'll send you the scheduling link." Then text: "https://calendly.com/..."

### IMPORTANT - Avoid Duplicates:
When you use send_text_message or send_voice_response tools, do NOT repeat that content in your final response.
If you send a link via send_text_message, your response should just acknowledge it, not include the link again.

- If user explicitly asks for "text", "write to me", "type" - disable voice mode with set_voice_mode(enabled=false)
- Keep voice responses under 30 seconds and conversational`
      : `
## Voice Mode: DISABLED
Respond with text messages.
- If the user sends a voice message, voice mode will auto-enable
- You can also enable voice mode with set_voice_mode if they ask for it`;

    // Build dynamic orchestration prompt section
    const dynamicConfig = this.config.dynamicOrchestration;
    let dynamicOrchestrationPrompt = "";
    let recentResultsPrompt = "";

    if (dynamicConfig?.enabled) {
      dynamicOrchestrationPrompt = `

${buildAgentReasoningPrompt()}
`;

      // Include recent agent results if available and result awareness is enabled
      if (dynamicConfig.enableResultAwareness && state.recentAgentResults) {
        const resultsAsAgentResults: Partial<Record<AgentType, AgentResult>> = {};
        for (const [type, result] of Object.entries(state.recentAgentResults)) {
          resultsAsAgentResults[type as AgentType] = {
            success: result.success,
            agentType: type as AgentType,
            response: result.response,
            data: result.data,
            error: result.error,
          };
        }
        recentResultsPrompt = buildAgentResultsContext(resultsAsAgentResults as Record<AgentType, AgentResult>);
      }
    }

    return `${basePrompt}

${contactContext}

## Your Role
You are the AI orchestrator for ${this.eventConfig.ownerName}'s networking assistant. You handle all conversations and decide what actions to take.

## Current Context
- Phone: ${context.phoneNumber}
- Channel: ${context.channel || "whatsapp"}
- Conversation turns: ${state.conversationTurns}
${voiceModeInstructions}
${recentResultsPrompt}
${dynamicOrchestrationPrompt}

## Available Actions
1. **Respond conversationally** - Answer questions, collect info, be helpful
2. **Update contact info** - When they share email, company, LinkedIn, etc.
3. **Send video** - When they ask for their video or you want to share it
4. **Generate video** - After collecting info from a promising lead
5. **Research** - When you have LinkedIn or company info to look up
6. **Schedule meeting** - Use get_available_times to show options, then create_booking_link when they choose
7. **Trigger parallel tasks** - Run multiple background tasks at once (research + CRM + video)
8. **Voice mode** - Enable/disable voice responses, send voice messages
${dynamicConfig?.enabled ? "9. **Dynamic agent orchestration** - Use decide_strategy and invoke_agents for complex multi-agent tasks" : ""}

## Scheduling Flow (HIGH PRIORITY)
When the user wants to schedule a meeting:
1. Use get_available_times to fetch available slots
2. **CRITICAL**: Include the actual time options DIRECTLY in your response text. Format them clearly:
   "Here are some available times:
   1. Wed, Feb 18 at 4:00 PM
   2. Wed, Feb 18 at 4:30 PM
   3. Wed, Feb 18 at 5:00 PM
   Just reply with the number that works best!"
3. **WHEN USER SELECTS**: If they say "3" or "option 3" or "third one":
   - Call create_booking_link with selectedOption: 3 (the EXACT number they said)
   - Example: User says "3" → selectedOption: 3
   - Example: User says "2" → selectedOption: 2
   - NEVER default to 1 unless they said "1"
4. The tool will return selectedTime - use EXACTLY this in your confirmation. Do NOT guess dates.
5. Include the booking link DIRECTLY in your response text

**CRITICAL**: When user picks a number, you MUST pass that exact number to create_booking_link. The system uses this to look up the correct time slot.

**IMPORTANT**: Always include times and links directly in your response. Do NOT just say "I'll send you the times" - actually include them.

**Time Selection Detection**: If the conversation shows available times were recently offered, and the user responds with:
- A number (1, 2, 3, 4, etc.) → Pass that number to selectedOption
- "the first/second/third one" → Convert to number (second = 2, third = 3)
- A time reference ("3pm", "Tuesday", etc.) → Find matching option number
→ Call create_booking_link with the correct selectedOption IMMEDIATELY.

## Guidelines
- Be friendly and conversational, not robotic
- Collect required info naturally (email, company, job title)
${dynamicConfig?.enabled ? "- For complex requests (research, qualification, multi-step tasks), use decide_strategy first, then invoke_agents" : "- After collecting info, use trigger_parallel_tasks to run research, CRM sync, and video generation in parallel"}
- If they share LinkedIn, trigger research
- If they ask about scheduling, use get_available_times to show them options (don't just send a link - help them choose a time!)
- If they ask to delete their data, confirm and delete
- Use parallel tasks to respond quickly while background work happens
- If the user asks to "talk", "chat by voice", "send voice notes", or similar - enable voice mode and respond with voice
- For scheduling: Help them choose a time conversationally, then create and send the booking link

## CRITICAL: Context & Memory
- **Never forget what was discussed** - maintain full awareness of ALL previous messages
- **Before asking for info, check if it was already provided** - reference what the user told you
- **When user selects an option (1, 2, 3...)**, confirm the SPECIFIC choice: "Great! I've booked Wednesday Feb 18 at 5:00 PM for you"
- **Respect user decisions** - if they say "I'll wait for Mike to reach out directly", do NOT send calendar links
- **Don't hallucinate having info you don't have** - if you don't know something, ask for it; if they told you, reference it

## Restraint
- Don't take actions the user didn't ask for
- If the user says they want to wait/think/handle something themselves, RESPECT that
- Focus on completing the current task before suggesting new ones

## Conversation Ending Detection
If the user sends a farewell message (like "thanks", "bye", emoji-only like "👍", "👋", "😊") after:
- Saying they'll wait for Mike directly, OR
- Declining further assistance, OR
- Confirming a completed action (booking, info collected)

Then your next response should be a BRIEF farewell only - do NOT:
- Restart the conversation
- Offer new help or suggestions
- Ask what else you can do
- Greet them again

Example: After "👍" as a farewell, just say "Great! Talk soon!" - don't launch into new topics.

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
        lastUserMessage: message,
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
      } else {
        // User sent a text message - auto-disable voice mode
        // They're typing, so they probably want text responses
        if (redis) {
          try {
            const wasVoiceMode = await redis.get(`voice_mode:${phoneNumber}`);
            if (wasVoiceMode === "true") {
              await redis.del(`voice_mode:${phoneNumber}`);
              logger.info({ phoneNumber }, "Voice mode auto-disabled (user sent text message)");
            }
          } catch {
            // Ignore Redis errors
          }
        }
        voiceModeEnabled = false;
      }

      // Get LLM client
      const llm = getLLMClient();

      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(context, state, voiceModeEnabled);

      // Load conversation history for context
      const messageStore = getMessageStore();
      const recentMessages = await messageStore.getRecentMessages(phoneNumber, 10);

      // Build messages array with history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      // Add recent conversation history (exclude the current message which we'll add at the end)
      for (const msg of recentMessages) {
        // Skip if no content or this is the current message we're processing
        if (!msg.content) continue;
        if (msg.content === message && msg.direction === "inbound") continue;

        const role = msg.direction === "inbound" ? "user" : "assistant";
        messages.push({ role, content: msg.content });
      }

      // Add the current message
      messages.push({ role: "user", content: message });

      logger.debug({ historyCount: messages.length - 1 }, "Loaded conversation history");

      // Call Claude with tools
      const response = await llm.runWithTools(
        {
          systemPrompt,
          messages,
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
