/**
 * Parallel Execution Module
 *
 * Exports all parallel execution components for the swarm architecture.
 * Enables independent operations (research, CRM sync, video generation)
 * to run concurrently without blocking the conversational flow.
 *
 * @example
 * import {
 *   ParallelTaskRunner,
 *   ParallelTaskBuilder,
 *   createResearchPipeline,
 * } from './swarm/parallel';
 *
 * // Fire-and-forget background tasks
 * const group = ParallelTaskBuilder.create()
 *   .researchAndSync(phoneNumber)
 *   .fireAndForget()
 *   .build(correlationId);
 *
 * await runner.execute(group, context);
 */

// Types
export type {
  ExecutionStrategy,
  ParallelTaskGroup,
  ParallelTask,
  ParallelExecutionResult,
  ParallelTaskResult,
  AgentParallelConfig,
  BackgroundTaskOptions,
  ResearchPipelineOptions,
  ParallelTaskJob,
  ParallelGroupCompletedEvent,
  ParallelTaskCompletedEvent,
} from "./types.js";

export { AGENT_PARALLEL_CONFIGS } from "./types.js";

// Task Runner
export {
  ParallelTaskRunner,
  getParallelTaskRunner,
  resetParallelTaskRunner,
} from "./task-runner.js";

// Task Builder
export {
  ParallelTaskBuilder,
  createResearchPipeline,
  createBackgroundTasks,
  createMediaPipeline,
} from "./task-builder.js";

// Metrics
export {
  parallelTasksTotal,
  parallelTaskDuration,
  parallelGroupsTotal,
  parallelGroupDuration,
  parallelGroupSize,
  activeParallelGroups,
  activeParallelTasks,
  parallelWavesTotal,
  recordParallelTaskStart,
  recordParallelTaskComplete,
  recordParallelGroupComplete,
  recordParallelGroupStart,
  recordWaveExecution,
} from "./metrics.js";
