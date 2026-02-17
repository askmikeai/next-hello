/**
 * Parallel Execution Types
 *
 * Type definitions for the parallel task execution system that enables
 * independent operations (research, CRM sync, video generation) to run
 * concurrently without blocking the conversational flow.
 */

import type { AgentType, AgentResult, TaskStatus } from "../types.js";

/**
 * Execution strategies for parallel task groups
 */
export type ExecutionStrategy = "fire-and-forget" | "wait-all" | "first-wins";

/**
 * Parallel task group - a collection of tasks to run together
 */
export interface ParallelTaskGroup {
  id: string;
  correlationId: string;
  strategy: ExecutionStrategy;
  tasks: ParallelTask[];
  timeout?: number;
  createdAt: Date;
}

/**
 * Individual task within a parallel group
 */
export interface ParallelTask {
  id: string;
  agentType: AgentType;
  action: string;
  input: Record<string, unknown>;
  priority: number;
  status: TaskStatus;
  dependsOn?: string[]; // Task IDs this depends on
  result?: AgentResult;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Result of parallel execution
 */
export interface ParallelExecutionResult {
  groupId: string;
  strategy: ExecutionStrategy;
  status: "completed" | "partial" | "failed" | "timeout";
  tasks: ParallelTaskResult[];
  mergedResult?: Record<string, unknown>;
  durationMs: number;
  completedCount: number;
  failedCount: number;
}

/**
 * Result for an individual parallel task
 */
export interface ParallelTaskResult {
  taskId: string;
  agentType: AgentType;
  action: string;
  status: TaskStatus;
  result?: AgentResult;
  error?: string;
  durationMs?: number;
}

/**
 * Configuration for how an agent can participate in parallel execution
 */
export interface AgentParallelConfig {
  /** Agent types this can run in parallel with */
  canRunParallelWith: AgentType[];
  /** Agent types that must complete first */
  dependsOn: AgentType[];
  /** Whether this agent runs in background (fire-and-forget suitable) */
  isBackground: boolean;
  /** Default priority (higher = runs first) */
  defaultPriority: number;
  /** Timeout in milliseconds */
  timeoutMs: number;
}

/**
 * Default parallel configurations per agent type
 */
export const AGENT_PARALLEL_CONFIGS: Record<AgentType, AgentParallelConfig> = {
  orchestrator: {
    canRunParallelWith: [],
    dependsOn: [],
    isBackground: false,
    defaultPriority: 100,
    timeoutMs: 30000,
  },
  research: {
    canRunParallelWith: ["crm", "qualification", "video", "voice"],
    dependsOn: [],
    isBackground: true,
    defaultPriority: 50,
    timeoutMs: 60000,
  },
  crm: {
    canRunParallelWith: ["research", "video", "voice", "qualification"],
    dependsOn: [],
    isBackground: true,
    defaultPriority: 30,
    timeoutMs: 30000,
  },
  qualification: {
    canRunParallelWith: ["crm", "video", "voice"],
    dependsOn: ["research"], // Wait for research to complete
    isBackground: false,
    defaultPriority: 40,
    timeoutMs: 15000,
  },
  personalization: {
    canRunParallelWith: ["video", "voice"],
    dependsOn: ["research", "qualification"],
    isBackground: false,
    defaultPriority: 35,
    timeoutMs: 20000,
  },
  video: {
    canRunParallelWith: ["voice", "crm", "research"],
    dependsOn: [],
    isBackground: true,
    defaultPriority: 20,
    timeoutMs: 300000, // 5 minutes for video generation
  },
  voice: {
    canRunParallelWith: ["video", "crm", "research"],
    dependsOn: [],
    isBackground: true,
    defaultPriority: 25,
    timeoutMs: 60000,
  },
};

/**
 * Options for triggering background tasks
 */
export interface BackgroundTaskOptions {
  /** Trigger research lookup */
  research?: boolean;
  /** Trigger CRM sync */
  crm?: boolean;
  /** Trigger video generation with first name */
  video?: { firstName: string };
  /** Trigger voice generation */
  voice?: { text: string };
  /** Additional data to pass to tasks */
  data?: Record<string, unknown>;
}

/**
 * Options for running a research pipeline
 */
export interface ResearchPipelineOptions {
  /** LinkedIn URL for research */
  linkedinUrl?: string;
  /** Company name for research */
  companyName?: string;
  /** Skip qualification after research */
  skipQualification?: boolean;
  /** Custom timeout for the pipeline */
  timeoutMs?: number;
}

/**
 * Queue job for parallel task execution
 */
export interface ParallelTaskJob {
  groupId: string;
  task: ParallelTask;
  correlationId: string;
  phoneNumber?: string;
  contactId?: string;
  configSnapshot: Record<string, unknown>;
}

/**
 * Event emitted when a parallel group completes
 */
export interface ParallelGroupCompletedEvent {
  groupId: string;
  correlationId: string;
  result: ParallelExecutionResult;
  timestamp: Date;
}

/**
 * Event emitted when an individual task completes
 */
export interface ParallelTaskCompletedEvent {
  groupId: string;
  taskId: string;
  correlationId: string;
  agentType: AgentType;
  result: ParallelTaskResult;
  timestamp: Date;
}
