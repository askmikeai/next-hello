/**
 * Parallel Execution Metrics
 *
 * Prometheus metrics for tracking parallel task execution performance,
 * group completion rates, and individual task durations.
 */

import { Counter, Histogram, Gauge } from "prom-client";
import { metricsRegistry } from "../../observability/metrics.js";

/**
 * Counter for total parallel tasks executed
 */
export const parallelTasksTotal = new Counter({
  name: "nexthello_parallel_tasks_total",
  help: "Total number of parallel tasks executed",
  labelNames: ["agent_type", "strategy", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for parallel task duration
 */
export const parallelTaskDuration = new Histogram({
  name: "nexthello_parallel_task_duration_seconds",
  help: "Duration of individual parallel tasks in seconds",
  labelNames: ["agent_type", "strategy"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [metricsRegistry],
});

/**
 * Counter for parallel groups executed
 */
export const parallelGroupsTotal = new Counter({
  name: "nexthello_parallel_groups_total",
  help: "Total number of parallel task groups executed",
  labelNames: ["strategy", "status"],
  registers: [metricsRegistry],
});

/**
 * Histogram for parallel group duration
 */
export const parallelGroupDuration = new Histogram({
  name: "nexthello_parallel_group_duration_seconds",
  help: "Duration of parallel task groups in seconds",
  labelNames: ["strategy"],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [metricsRegistry],
});

/**
 * Histogram for tasks per parallel group
 */
export const parallelGroupSize = new Histogram({
  name: "nexthello_parallel_group_size",
  help: "Number of tasks per parallel group",
  labelNames: ["strategy"],
  buckets: [1, 2, 3, 4, 5, 7, 10, 15, 20],
  registers: [metricsRegistry],
});

/**
 * Gauge for currently executing parallel groups
 */
export const activeParallelGroups = new Gauge({
  name: "nexthello_active_parallel_groups",
  help: "Number of currently executing parallel task groups",
  registers: [metricsRegistry],
});

/**
 * Gauge for currently executing parallel tasks
 */
export const activeParallelTasks = new Gauge({
  name: "nexthello_active_parallel_tasks",
  help: "Number of currently executing parallel tasks",
  labelNames: ["agent_type"],
  registers: [metricsRegistry],
});

/**
 * Counter for dependency resolution waves
 */
export const parallelWavesTotal = new Counter({
  name: "nexthello_parallel_waves_total",
  help: "Total number of dependency waves executed in wait-all strategy",
  registers: [metricsRegistry],
});

/**
 * Record the start of a parallel task
 */
export function recordParallelTaskStart(
  agentType: string,
  strategy: string
): void {
  activeParallelTasks.inc({ agent_type: agentType });
}

/**
 * Record the completion of a parallel task
 */
export function recordParallelTaskComplete(
  agentType: string,
  strategy: string,
  status: "success" | "failure",
  durationMs: number
): void {
  parallelTasksTotal.inc({ agent_type: agentType, strategy, status });
  parallelTaskDuration.observe({ agent_type: agentType, strategy }, durationMs / 1000);
  activeParallelTasks.dec({ agent_type: agentType });
}

/**
 * Record the completion of a parallel group
 */
export function recordParallelGroupComplete(
  strategy: string,
  status: string,
  durationMs: number
): void {
  parallelGroupsTotal.inc({ strategy, status });
  parallelGroupDuration.observe({ strategy }, durationMs / 1000);
}

/**
 * Record a parallel group being started
 */
export function recordParallelGroupStart(
  strategy: string,
  taskCount: number
): void {
  parallelGroupSize.observe({ strategy }, taskCount);
}

/**
 * Record a dependency wave being executed
 */
export function recordWaveExecution(): void {
  parallelWavesTotal.inc();
}
