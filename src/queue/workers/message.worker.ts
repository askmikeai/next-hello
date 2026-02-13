import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logQueueJob, logError } from "../../observability/logger.js";
import { getOrchestrator } from "../../swarm/orchestrator.js";
import { getMessageStore } from "../../history/message-store.js";
import { getContextBuilder } from "../../history/context-builder.js";
import { findContactByPhone } from "../../contacts/index.js";
import type { IncomingMessageJob, Channel } from "../../swarm/types.js";
import type { NetworkingEventConfig } from "../../config/types.js";

const logger = createWorkerLogger("message-worker");

/**
 * Message worker result
 */
export interface MessageWorkerResult {
  success: boolean;
  correlationId: string;
  response?: string;
  error?: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Process an incoming message through the swarm
 */
async function processIncomingMessage(
  job: Job<IncomingMessageJob>,
  config: NetworkingEventConfig
): Promise<MessageWorkerResult> {
  const { correlationId, phoneNumber, channel, message, timestamp } = job.data;
  const jobLogger = logger.child({ correlationId, jobId: job.id });

  try {
    // Get dependencies
    const orchestrator = getOrchestrator(config);
    const messageStore = getMessageStore();
    const contextBuilder = getContextBuilder();

    // Look up contact
    const contact = await findContactByPhone(phoneNumber, config.supabase);

    // Store the inbound message
    await messageStore.storeInboundMessage(
      phoneNumber,
      message,
      channel,
      correlationId,
      contact?.id
    );

    // Build conversation context
    const context = await contextBuilder.buildContext(
      phoneNumber,
      contact
    );

    jobLogger.debug(
      {
        contactId: contact?.id,
        contextMessages: context.messageCount,
        contextTokens: context.estimatedTokens,
      },
      "Processing message with context"
    );

    // Process through orchestrator
    const result = await orchestrator.processMessage(
      phoneNumber,
      message,
      channel,
      contact ?? undefined
    );

    // Store the outbound message if we have a response
    if (result.success && result.response) {
      await messageStore.storeOutboundMessage(
        phoneNumber,
        result.response,
        channel,
        correlationId,
        {
          contactId: contact?.id,
          agentId: result.agentType,
          tokensUsed: result.tokensUsed
            ? result.tokensUsed.input + result.tokensUsed.output
            : undefined,
        }
      );
    }

    return {
      success: result.success,
      correlationId,
      response: result.response,
      error: result.error,
      tokensUsed: result.tokensUsed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logError(jobLogger, error as Error, "Failed to process message");

    return {
      success: false,
      correlationId,
      error: errorMessage,
    };
  }
}

/**
 * Create the message worker
 * Returns null if Redis is unavailable
 */
export function createMessageWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<IncomingMessageJob, MessageWorkerResult> | null {
  const processor: JobProcessor<IncomingMessageJob, MessageWorkerResult> = async (job) => {
    return processIncomingMessage(job, config);
  };

  return createWorker<IncomingMessageJob, MessageWorkerResult>(
    "incoming-messages",
    processor,
    {
      concurrency: options?.concurrency ?? 10,
      limiter: {
        max: 100,
        duration: 60000, // 100 messages per minute
      },
    }
  );
}

/**
 * Message worker with send callback
 * This version accepts a callback for sending responses
 * Returns null if Redis is unavailable
 */
export function createMessageWorkerWithCallback(
  config: NetworkingEventConfig,
  sendResponse: (phoneNumber: string, message: string, channel: Channel) => Promise<void>,
  options?: {
    concurrency?: number;
  }
): Worker<IncomingMessageJob, MessageWorkerResult> | null {
  const processor: JobProcessor<IncomingMessageJob, MessageWorkerResult> = async (job) => {
    const result = await processIncomingMessage(job, config);

    // Send the response if successful
    if (result.success && result.response) {
      try {
        await sendResponse(job.data.phoneNumber, result.response, job.data.channel);
        logger.info(
          { correlationId: result.correlationId, phoneNumber: job.data.phoneNumber },
          "Response sent successfully"
        );
      } catch (error) {
        logError(logger, error as Error, "Failed to send response", {
          correlationId: result.correlationId,
        });
      }
    }

    return result;
  };

  return createWorker<IncomingMessageJob, MessageWorkerResult>(
    "incoming-messages",
    processor,
    {
      concurrency: options?.concurrency ?? 10,
    }
  );
}
