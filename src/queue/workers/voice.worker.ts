import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logError } from "../../observability/logger.js";
import { recordJobProcessed, startTimer } from "../../observability/metrics.js";
import { createAgent } from "../../swarm/base-agent.js";
import { createLogger } from "../../observability/logger.js";
import { findContactByPhone, updateContactByPhone } from "../../contacts/index.js";
import type { VoiceGenerationJob, AgentContext } from "../../swarm/types.js";
import type { NetworkingEventConfig } from "../../config/types.js";

// Import to register the agent factory
import "../../swarm/agents/voice.agent.js";

const logger = createWorkerLogger("voice-worker");

/**
 * Voice worker result
 */
export interface VoiceWorkerResult {
  success: boolean;
  correlationId: string;
  contactId: string;
  audioGenerated: boolean;
  error?: string;
}

/**
 * Process a voice generation job
 */
async function processVoiceJob(
  job: Job<VoiceGenerationJob>,
  config: NetworkingEventConfig
): Promise<VoiceWorkerResult> {
  const { correlationId, contactId, phoneNumber, firstName, lastName, companyName, scriptText, variables } = job.data;

  const jobLogger = logger.child({ correlationId, contactId, jobId: job.id });
  const endTimer = startTimer();

  try {
    // Get the contact
    const contact = await findContactByPhone(phoneNumber, config.supabase);

    // Create voice agent
    const voiceAgent = createAgent("voice");

    // Build context
    const context: AgentContext = {
      correlationId,
      config,
      contact: contact ?? undefined,
      phoneNumber,
      logger: createLogger({ correlationId, component: "voice-agent" }),
    };

    // Build voice generation prompt
    const voicePrompt = buildVoicePrompt({
      phoneNumber,
      firstName,
      lastName,
      companyName,
      scriptText,
    });

    jobLogger.info({ firstName, companyName }, "Starting voice generation");

    // Execute voice generation through the agent
    const result = await voiceAgent.process(context, voicePrompt);

    // Update contact status based on result
    // TODO: voice_status field needs to be added to NetworkingContact type
    if (result.success) {
      jobLogger.info("Voice generation successful");
    }

    jobLogger.info({ success: result.success }, "Voice generation completed");

    recordJobProcessed("voice-generation", result.success ? "success" : "failure", endTimer());

    return {
      success: result.success,
      correlationId,
      contactId,
      audioGenerated: result.success,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(jobLogger, error as Error, "Voice generation job failed");

    recordJobProcessed("voice-generation", "failure", endTimer());

    return {
      success: false,
      correlationId,
      contactId,
      audioGenerated: false,
      error: errorMessage,
    };
  }
}

/**
 * Build a voice generation prompt
 */
function buildVoicePrompt(data: {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  scriptText?: string;
}): string {
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ") || "friend";

  // Use provided script or generate a default personalized greeting
  const script = data.scriptText ||
    `Hey ${data.firstName || "there"}! Michael asked me to follow up. He's an AI Swarm Architect and would love to connect. Would you be open to a quick call?`;

  return `Generate and send a voice message to this contact:

Phone number: ${data.phoneNumber}
Recipient name: ${fullName}
Script to speak: ${script}

Steps:
1. Call generate_voice_message with phoneNumber="${data.phoneNumber}", script="${script}", recipientName="${fullName}"
2. Then call send_voice_message with the phoneNumber and the audioPath from step 1

Do this now.`;
}

/**
 * Create the voice worker
 */
export function createVoiceWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<VoiceGenerationJob, VoiceWorkerResult> | null {
  const processor: JobProcessor<VoiceGenerationJob, VoiceWorkerResult> = async (job) => {
    return processVoiceJob(job, config);
  };

  return createWorker<VoiceGenerationJob, VoiceWorkerResult>(
    "voice-generation",
    processor,
    {
      concurrency: options?.concurrency ?? 2,
      limiter: {
        max: 10,
        duration: 60000, // 10 voice jobs per minute
      },
    }
  );
}
