/**
 * Agent Task Worker
 *
 * Generic worker for processing agent tasks from the parallel execution queue.
 * Handles fire-and-forget background tasks by executing agents asynchronously.
 */

import type { Job, Worker } from "bullmq";
import { createWorker, type JobProcessor } from "../client.js";
import { createWorkerLogger, logError } from "../../observability/logger.js";
import { recordJobProcessed, startTimer } from "../../observability/metrics.js";
import { createAgent, getRegisteredAgentTypes } from "../../swarm/base-agent.js";
import type { AgentContext, AgentResult } from "../../swarm/types.js";
import type { ParallelTaskJob } from "../../swarm/parallel/types.js";
import {
  recordParallelTaskComplete,
  AGENT_PARALLEL_CONFIGS,
} from "../../swarm/parallel/index.js";
import type { NetworkingEventConfig } from "../../config/types.js";
import { findContactByPhone } from "../../contacts/index.js";
import { createLogger } from "../../observability/logger.js";

const logger = createWorkerLogger("agent-task-worker");

/**
 * Result of processing an agent task
 */
export interface AgentTaskWorkerResult {
  success: boolean;
  groupId: string;
  taskId: string;
  agentType: string;
  result?: AgentResult;
  error?: string;
  durationMs: number;
}

/**
 * Process an agent task job
 */
async function processAgentTaskJob(
  job: Job<ParallelTaskJob>,
  config: NetworkingEventConfig
): Promise<AgentTaskWorkerResult> {
  const { groupId, task, correlationId, phoneNumber, contactId } = job.data;
  const jobLogger = logger.child({
    correlationId,
    groupId,
    taskId: task.id,
    agentType: task.agentType,
    jobId: job.id,
  });
  const endTimer = startTimer();

  try {
    jobLogger.info(
      { action: task.action, input: task.input },
      "Processing agent task"
    );

    // Check if agent type is registered
    const registeredTypes = getRegisteredAgentTypes();
    if (!registeredTypes.includes(task.agentType)) {
      jobLogger.warn(
        { agentType: task.agentType, registeredTypes },
        "Agent type not registered"
      );

      const durationMs = endTimer();
      recordJobProcessed("agent-tasks", "failure", durationMs);
      recordParallelTaskComplete(task.agentType, "fire-and-forget", "failure", durationMs);

      return {
        success: false,
        groupId,
        taskId: task.id,
        agentType: task.agentType,
        error: `Agent type not registered: ${task.agentType}`,
        durationMs,
      };
    }

    // Look up contact if we have a phone number
    let contact;
    if (phoneNumber) {
      try {
        contact = await findContactByPhone(phoneNumber, config.supabase);
      } catch (error) {
        jobLogger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "Failed to look up contact"
        );
      }
    }

    // Build agent context
    const agentLogger = createLogger({
      component: "agent-task",
      correlationId,
      agentType: task.agentType,
    });

    const context: AgentContext = {
      correlationId,
      config,
      contact: contact || undefined,
      phoneNumber,
      logger: agentLogger,
    };

    // Create and execute the agent
    const agent = createAgent(task.agentType);

    // Build input string from task input
    const input = JSON.stringify(task.input);

    // Execute with timeout from agent config
    const agentConfig = AGENT_PARALLEL_CONFIGS[task.agentType];
    const timeoutMs = agentConfig?.timeoutMs || 60000;

    const resultPromise = agent.process(context, input);
    const timeoutPromise = new Promise<AgentResult>((_, reject) =>
      setTimeout(() => reject(new Error("Task timeout")), timeoutMs)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const durationMs = endTimer();

    jobLogger.info(
      {
        success: result.success,
        response: result.response?.substring(0, 100),
        durationMs,
      },
      "Agent task completed"
    );

    recordJobProcessed("agent-tasks", result.success ? "success" : "failure", durationMs);
    recordParallelTaskComplete(
      task.agentType,
      "fire-and-forget",
      result.success ? "success" : "failure",
      durationMs
    );

    return {
      success: result.success,
      groupId,
      taskId: task.id,
      agentType: task.agentType,
      result,
      error: result.error,
      durationMs,
    };
  } catch (error) {
    const durationMs = endTimer();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logError(jobLogger, error as Error, "Agent task failed");

    recordJobProcessed("agent-tasks", "failure", durationMs);
    recordParallelTaskComplete(task.agentType, "fire-and-forget", "failure", durationMs);

    return {
      success: false,
      groupId,
      taskId: task.id,
      agentType: task.agentType,
      error: errorMessage,
      durationMs,
    };
  }
}

/**
 * Create the agent task worker
 */
export function createAgentTaskWorker(
  config: NetworkingEventConfig,
  options?: {
    concurrency?: number;
  }
): Worker<ParallelTaskJob, AgentTaskWorkerResult> | null {
  const processor: JobProcessor<ParallelTaskJob, AgentTaskWorkerResult> = async (job) => {
    return processAgentTaskJob(job, config);
  };

  return createWorker<ParallelTaskJob, AgentTaskWorkerResult>(
    "agent-tasks",
    processor,
    {
      concurrency: options?.concurrency ?? 10, // Higher concurrency for agent tasks
      lockDuration: 300000, // 5 minute lock (some agents take time)
    }
  );
}

export default createAgentTaskWorker;
