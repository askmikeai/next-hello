/**
 * ParallelTaskRunner - Core execution engine for parallel agent tasks
 *
 * Supports three execution strategies:
 * - fire-and-forget: Queue all tasks and return immediately
 * - wait-all: Execute in waves based on dependencies
 * - first-wins: Race all tasks, return first successful result
 */

import type { Logger } from "pino";
import { createLogger } from "../../observability/logger.js";
import { addJob, addBulkJobs, getQueue, getQueueEvents } from "../../queue/client.js";
import { createAgent, getRegisteredAgentTypes } from "../base-agent.js";
import { getActivityStore } from "../../observability/activity-store.js";
import type { AgentContext, AgentResult, AgentType } from "../types.js";
import {
  type ParallelTaskGroup,
  type ParallelTask,
  type ParallelExecutionResult,
  type ParallelTaskResult,
  type ParallelTaskJob,
  AGENT_PARALLEL_CONFIGS,
} from "./types.js";
import {
  recordParallelTaskStart,
  recordParallelTaskComplete,
  recordParallelGroupComplete,
  activeParallelGroups,
} from "./metrics.js";

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique group ID
 */
function generateGroupId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * ParallelTaskRunner - Executes groups of tasks in parallel
 */
export class ParallelTaskRunner {
  private logger: Logger;

  constructor() {
    this.logger = createLogger({ component: "parallel-task-runner" });
  }

  /**
   * Execute a parallel task group based on its strategy
   */
  async execute(
    group: ParallelTaskGroup,
    context: AgentContext
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    activeParallelGroups.inc();

    this.logger.info(
      {
        groupId: group.id,
        strategy: group.strategy,
        taskCount: group.tasks.length,
        correlationId: group.correlationId,
      },
      "Starting parallel execution"
    );

    try {
      let result: ParallelExecutionResult;

      switch (group.strategy) {
        case "fire-and-forget":
          result = await this.executeFireAndForget(group, context);
          break;
        case "wait-all":
          result = await this.executeWaitAll(group, context);
          break;
        case "first-wins":
          result = await this.executeFirstWins(group, context);
          break;
        default:
          throw new Error(`Unknown execution strategy: ${group.strategy}`);
      }

      result.durationMs = Date.now() - startTime;
      recordParallelGroupComplete(group.strategy, result.status, result.durationMs);

      this.logger.info(
        {
          groupId: group.id,
          strategy: group.strategy,
          status: result.status,
          durationMs: result.durationMs,
          completedCount: result.completedCount,
          failedCount: result.failedCount,
        },
        "Parallel execution completed"
      );

      return result;
    } finally {
      activeParallelGroups.dec();
    }
  }

  /**
   * Fire-and-forget: Queue all tasks and return immediately
   * Tasks run asynchronously in the background
   */
  private async executeFireAndForget(
    group: ParallelTaskGroup,
    context: AgentContext
  ): Promise<ParallelExecutionResult> {
    const jobs: Array<{ data: ParallelTaskJob; opts?: { priority?: number } }> = [];

    for (const task of group.tasks) {
      recordParallelTaskStart(task.agentType, group.strategy);

      const jobData: ParallelTaskJob = {
        groupId: group.id,
        task: {
          ...task,
          status: "pending",
          startedAt: new Date(),
        },
        correlationId: group.correlationId,
        phoneNumber: context.phoneNumber,
        contactId: context.contact?.id,
        configSnapshot: {
          eventName: context.config.eventName,
          ownerName: context.config.ownerName,
        },
      };

      jobs.push({
        data: jobData,
        opts: { priority: task.priority },
      });
    }

    // Queue all jobs in bulk
    await addBulkJobs("agent-tasks", jobs);

    this.logger.info(
      {
        groupId: group.id,
        queuedCount: jobs.length,
      },
      "Queued fire-and-forget tasks"
    );

    // Return immediately - tasks will complete asynchronously
    return {
      groupId: group.id,
      strategy: "fire-and-forget",
      status: "completed",
      tasks: group.tasks.map((task) => ({
        taskId: task.id,
        agentType: task.agentType,
        action: task.action,
        status: "pending",
      })),
      durationMs: 0,
      completedCount: 0, // Not tracked for fire-and-forget
      failedCount: 0,
    };
  }

  /**
   * Wait-all: Execute tasks in waves based on dependency graph
   * Respects task dependencies - dependent tasks wait for their dependencies
   */
  private async executeWaitAll(
    group: ParallelTaskGroup,
    context: AgentContext
  ): Promise<ParallelExecutionResult> {
    const timeout = group.timeout || 120000; // 2 minute default
    const startTime = Date.now();
    const results: ParallelTaskResult[] = [];
    const completedTaskIds = new Set<string>();
    const taskResultMap = new Map<string, AgentResult>();

    // Build execution waves from dependency graph
    const waves = this.buildExecutionWaves(group.tasks);

    this.logger.info(
      {
        groupId: group.id,
        waveCount: waves.length,
        waves: waves.map((w, i) => ({
          wave: i,
          tasks: w.map((t) => t.agentType),
        })),
      },
      "Built execution waves"
    );

    // Execute wave by wave
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      const remainingTime = timeout - (Date.now() - startTime);

      if (remainingTime <= 0) {
        // Timeout - mark remaining tasks as failed
        for (const task of wave) {
          results.push({
            taskId: task.id,
            agentType: task.agentType,
            action: task.action,
            status: "failed",
            error: "Execution timeout",
          });
        }
        break;
      }

      // Execute all tasks in this wave in parallel
      const wavePromises = wave.map((task) =>
        this.executeTask(task, context, remainingTime, taskResultMap)
      );

      const waveResults = await Promise.allSettled(wavePromises);

      // Process results
      for (let i = 0; i < waveResults.length; i++) {
        const task = wave[i];
        const settledResult = waveResults[i];

        if (settledResult.status === "fulfilled") {
          const taskResult = settledResult.value;
          results.push(taskResult);
          if (taskResult.status === "completed" && taskResult.result) {
            completedTaskIds.add(task.id);
            taskResultMap.set(task.id, taskResult.result);
          }
          recordParallelTaskComplete(
            task.agentType,
            group.strategy,
            taskResult.status === "completed" ? "success" : "failure",
            taskResult.durationMs || 0
          );
        } else {
          const error = settledResult.reason instanceof Error
            ? settledResult.reason.message
            : String(settledResult.reason);
          results.push({
            taskId: task.id,
            agentType: task.agentType,
            action: task.action,
            status: "failed",
            error,
          });
          recordParallelTaskComplete(task.agentType, group.strategy, "failure", 0);
        }
      }
    }

    const completedCount = results.filter((r) => r.status === "completed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    return {
      groupId: group.id,
      strategy: "wait-all",
      status: failedCount === 0 ? "completed" : failedCount === results.length ? "failed" : "partial",
      tasks: results,
      mergedResult: this.mergeResults(taskResultMap),
      durationMs: Date.now() - startTime,
      completedCount,
      failedCount,
    };
  }

  /**
   * First-wins: Race all tasks, return first successful result
   * Useful for redundant lookups where any success is sufficient
   */
  private async executeFirstWins(
    group: ParallelTaskGroup,
    context: AgentContext
  ): Promise<ParallelExecutionResult> {
    const timeout = group.timeout || 30000; // 30 second default
    const startTime = Date.now();

    // Create an AbortController to cancel remaining tasks
    const abortController = new AbortController();

    // Record start for all tasks
    for (const task of group.tasks) {
      recordParallelTaskStart(task.agentType, group.strategy);
    }

    // Race all tasks with a timeout
    const racePromise = Promise.race([
      ...group.tasks.map(async (task): Promise<ParallelTaskResult> => {
        const taskStart = Date.now();
        try {
          const result = await this.executeTask(task, context, timeout);
          if (result.status === "completed" && result.result?.success) {
            // Signal to abort other tasks
            abortController.abort();
            return result;
          }
          return result;
        } catch (error) {
          return {
            taskId: task.id,
            agentType: task.agentType,
            action: task.action,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - taskStart,
          };
        }
      }),
      // Timeout fallback
      new Promise<ParallelTaskResult>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout)
      ),
    ]);

    try {
      const firstResult = await racePromise;
      const durationMs = Date.now() - startTime;

      recordParallelTaskComplete(
        firstResult.agentType,
        group.strategy,
        firstResult.status === "completed" ? "success" : "failure",
        firstResult.durationMs || durationMs
      );

      return {
        groupId: group.id,
        strategy: "first-wins",
        status: firstResult.status === "completed" ? "completed" : "failed",
        tasks: [firstResult],
        mergedResult: firstResult.result?.data,
        durationMs,
        completedCount: firstResult.status === "completed" ? 1 : 0,
        failedCount: firstResult.status === "failed" ? 1 : 0,
      };
    } catch (error) {
      return {
        groupId: group.id,
        strategy: "first-wins",
        status: "timeout",
        tasks: group.tasks.map((task) => ({
          taskId: task.id,
          agentType: task.agentType,
          action: task.action,
          status: "failed",
          error: "All tasks failed or timed out",
        })),
        durationMs: Date.now() - startTime,
        completedCount: 0,
        failedCount: group.tasks.length,
      };
    }
  }

  /**
   * Execute a single task directly (in-process)
   */
  private async executeTask(
    task: ParallelTask,
    context: AgentContext,
    timeoutMs: number,
    previousResults?: Map<string, AgentResult>
  ): Promise<ParallelTaskResult> {
    const startTime = Date.now();
    const config = AGENT_PARALLEL_CONFIGS[task.agentType];
    const effectiveTimeout = Math.min(timeoutMs, config?.timeoutMs || 60000);
    const activityStore = getActivityStore();

    // Start activity tracking
    const activityId = await activityStore.startActivity({
      correlationId: context.correlationId,
      contactId: context.contact?.id,
      agentType: task.agentType,
      action: task.action,
    });

    try {
      // Check if agent type is registered
      const registeredTypes = getRegisteredAgentTypes();
      if (!registeredTypes.includes(task.agentType)) {
        const durationMs = Date.now() - startTime;
        if (activityId) {
          await activityStore.completeActivity(activityId, {
            status: "failed",
            durationMs,
            errorMessage: `Agent type not registered: ${task.agentType}`,
          });
        }
        return {
          taskId: task.id,
          agentType: task.agentType,
          action: task.action,
          status: "failed",
          error: `Agent type not registered: ${task.agentType}`,
          durationMs,
        };
      }

      // Create agent and execute
      const agent = createAgent(task.agentType);

      // Build input from task input and previous results
      let input = JSON.stringify(task.input);
      if (previousResults && previousResults.size > 0) {
        // Inject previous results into context
        const enrichedInput = {
          ...task.input,
          _previousResults: Object.fromEntries(previousResults),
        };
        input = JSON.stringify(enrichedInput);
      }

      // Execute with timeout
      const resultPromise = agent.process(context, input);
      const timeoutPromise = new Promise<AgentResult>((_, reject) =>
        setTimeout(() => reject(new Error("Task timeout")), effectiveTimeout)
      );

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      // Complete activity tracking
      if (activityId) {
        await activityStore.completeActivity(activityId, {
          status: result.success ? "completed" : "failed",
          durationMs,
          inputTokens: result.tokensUsed?.input,
          outputTokens: result.tokensUsed?.output,
          errorMessage: result.error,
        });
      }

      return {
        taskId: task.id,
        agentType: task.agentType,
        action: task.action,
        status: result.success ? "completed" : "failed",
        result,
        error: result.error,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Complete activity tracking with error
      if (activityId) {
        await activityStore.completeActivity(activityId, {
          status: "failed",
          durationMs,
          errorMessage,
        });
      }

      return {
        taskId: task.id,
        agentType: task.agentType,
        action: task.action,
        status: "failed",
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Build execution waves from dependency graph
   * Tasks with no dependencies go in wave 0, tasks depending on wave 0 go in wave 1, etc.
   */
  private buildExecutionWaves(tasks: ParallelTask[]): ParallelTask[][] {
    const waves: ParallelTask[][] = [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const remaining = new Set(tasks.map((t) => t.id));

    while (remaining.size > 0) {
      const wave: ParallelTask[] = [];

      for (const taskId of remaining) {
        const task = taskMap.get(taskId)!;
        const deps = task.dependsOn || [];

        // Check if all dependencies are completed
        const depsReady = deps.every((depId) => completed.has(depId));

        if (depsReady) {
          wave.push(task);
        }
      }

      if (wave.length === 0 && remaining.size > 0) {
        // Circular dependency or missing dependency - break cycle
        this.logger.warn(
          { remaining: Array.from(remaining) },
          "Detected circular or missing dependency, adding remaining tasks to final wave"
        );
        for (const taskId of remaining) {
          wave.push(taskMap.get(taskId)!);
        }
      }

      // Sort wave by priority (higher first)
      wave.sort((a, b) => b.priority - a.priority);

      // Move tasks from remaining to completed
      for (const task of wave) {
        remaining.delete(task.id);
        completed.add(task.id);
      }

      waves.push(wave);
    }

    return waves;
  }

  /**
   * Merge results from all completed tasks into a single object
   */
  private mergeResults(resultMap: Map<string, AgentResult>): Record<string, unknown> {
    const merged: Record<string, unknown> = {};

    for (const [taskId, result] of resultMap) {
      if (result.data) {
        // Extract agent type from task ID or use as key
        const agentType = result.agentType || taskId;
        merged[agentType] = result.data;
      }
    }

    return merged;
  }

  /**
   * Create a task for a specific agent type
   */
  createTask(
    agentType: AgentType,
    action: string,
    input: Record<string, unknown>,
    options?: {
      priority?: number;
      dependsOn?: string[];
    }
  ): ParallelTask {
    const config = AGENT_PARALLEL_CONFIGS[agentType];
    return {
      id: generateTaskId(),
      agentType,
      action,
      input,
      priority: options?.priority ?? config?.defaultPriority ?? 50,
      status: "pending",
      dependsOn: options?.dependsOn,
    };
  }

  /**
   * Create a task group with the specified strategy
   */
  createGroup(
    correlationId: string,
    strategy: ParallelTaskGroup["strategy"],
    tasks: ParallelTask[],
    timeout?: number
  ): ParallelTaskGroup {
    return {
      id: generateGroupId(),
      correlationId,
      strategy,
      tasks,
      timeout,
      createdAt: new Date(),
    };
  }
}

// Singleton instance
let instance: ParallelTaskRunner | null = null;

/**
 * Get the ParallelTaskRunner singleton
 */
export function getParallelTaskRunner(): ParallelTaskRunner {
  if (!instance) {
    instance = new ParallelTaskRunner();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetParallelTaskRunner(): void {
  instance = null;
}
