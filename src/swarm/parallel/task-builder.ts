/**
 * ParallelTaskBuilder - Fluent API for building parallel task groups
 *
 * Provides a chainable interface for constructing parallel execution groups
 * with common patterns like research+sync, media generation, and pipelines.
 *
 * @example
 * const group = ParallelTaskBuilder.create()
 *   .researchAndSync(phoneNumber, linkedinUrl)  // Research + CRM in parallel
 *   .thenQualify(phoneNumber)                   // Qualification after research
 *   .generateMedia(phoneNumber, firstName)      // Video + Voice in parallel
 *   .fireAndForget()                            // Strategy
 *   .build(correlationId);
 */

import type {
  ParallelTaskGroup,
  ParallelTask,
  ExecutionStrategy,
} from "./types.js";
import { AGENT_PARALLEL_CONFIGS } from "./types.js";
import type { AgentType } from "../types.js";

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
 * Fluent builder for parallel task groups
 */
export class ParallelTaskBuilder {
  private tasks: ParallelTask[] = [];
  private strategy: ExecutionStrategy = "wait-all";
  private timeout?: number;
  private lastTaskIds: string[] = [];

  private constructor() {}

  /**
   * Create a new builder instance
   */
  static create(): ParallelTaskBuilder {
    return new ParallelTaskBuilder();
  }

  /**
   * Add a research task
   */
  research(
    phoneNumber: string,
    options?: {
      linkedinUrl?: string;
      companyName?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
    }
  ): this {
    const task = this.createTask("research", "pdl_enrich", {
      phoneNumber,
      ...options,
    });
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add a CRM sync task
   */
  crmSync(
    phoneNumber: string,
    options?: {
      contactId?: string;
      operation?: "create" | "update" | "sync";
    }
  ): this {
    const task = this.createTask("crm", "sync", {
      phoneNumber,
      operation: options?.operation || "sync",
      contactId: options?.contactId,
    });
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add a qualification task
   */
  qualify(phoneNumber: string, researchData?: Record<string, unknown>): this {
    const task = this.createTask("qualification", "qualify", {
      phoneNumber,
      researchData,
    });
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add a video generation task
   */
  generateVideo(phoneNumber: string, firstName: string, script?: string): this {
    const task = this.createTask("video", "generate", {
      phoneNumber,
      firstName,
      script,
    });
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add a voice message generation task
   */
  generateVoice(phoneNumber: string, text: string): this {
    const task = this.createTask("voice", "generate", {
      phoneNumber,
      text,
    });
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add research and CRM sync to run in parallel
   */
  researchAndSync(
    phoneNumber: string,
    options?: {
      linkedinUrl?: string;
      companyName?: string;
      email?: string;
    }
  ): this {
    const researchTask = this.createTask("research", "pdl_enrich", {
      phoneNumber,
      ...options,
    });
    const crmTask = this.createTask("crm", "sync", {
      phoneNumber,
      operation: "sync",
    });

    this.tasks.push(researchTask, crmTask);
    this.lastTaskIds = [researchTask.id, crmTask.id];
    return this;
  }

  /**
   * Add qualification that depends on previous tasks (typically research)
   */
  thenQualify(phoneNumber: string): this {
    const task = this.createTask(
      "qualification",
      "qualify",
      { phoneNumber },
      { dependsOn: this.lastTaskIds.filter((id) =>
        this.tasks.find((t) => t.id === id && t.agentType === "research")
      )}
    );
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add video and voice generation in parallel
   */
  generateMedia(phoneNumber: string, firstName: string, voiceText?: string): this {
    const videoTask = this.createTask("video", "generate", {
      phoneNumber,
      firstName,
    });
    const tasks = [videoTask];
    const taskIds = [videoTask.id];

    if (voiceText) {
      const voiceTask = this.createTask("voice", "generate", {
        phoneNumber,
        text: voiceText,
      });
      tasks.push(voiceTask);
      taskIds.push(voiceTask.id);
    }

    this.tasks.push(...tasks);
    this.lastTaskIds = taskIds;
    return this;
  }

  /**
   * Add a generic task for any agent type
   */
  addTask(
    agentType: AgentType,
    action: string,
    input: Record<string, unknown>,
    options?: {
      priority?: number;
      dependsOn?: string[];
    }
  ): this {
    const task = this.createTask(agentType, action, input, options);
    this.tasks.push(task);
    this.lastTaskIds = [task.id];
    return this;
  }

  /**
   * Add multiple tasks in parallel (no dependencies between them)
   */
  parallel(...taskDefs: Array<{
    agentType: AgentType;
    action: string;
    input: Record<string, unknown>;
  }>): this {
    const newTaskIds: string[] = [];

    for (const def of taskDefs) {
      const task = this.createTask(def.agentType, def.action, def.input);
      this.tasks.push(task);
      newTaskIds.push(task.id);
    }

    this.lastTaskIds = newTaskIds;
    return this;
  }

  /**
   * Make subsequent tasks depend on all previous tasks
   */
  then(): this {
    // Just a marker - actual dependency is set on the next task
    return this;
  }

  /**
   * Set fire-and-forget strategy (queue and return immediately)
   */
  fireAndForget(): this {
    this.strategy = "fire-and-forget";
    return this;
  }

  /**
   * Set wait-all strategy (wait for all tasks respecting dependencies)
   */
  waitAll(): this {
    this.strategy = "wait-all";
    return this;
  }

  /**
   * Set first-wins strategy (return first successful result)
   */
  firstWins(): this {
    this.strategy = "first-wins";
    return this;
  }

  /**
   * Set a custom timeout for the group
   */
  withTimeout(timeoutMs: number): this {
    this.timeout = timeoutMs;
    return this;
  }

  /**
   * Build the final ParallelTaskGroup
   */
  build(correlationId: string): ParallelTaskGroup {
    if (this.tasks.length === 0) {
      throw new Error("Cannot build empty task group");
    }

    return {
      id: generateGroupId(),
      correlationId,
      strategy: this.strategy,
      tasks: this.tasks,
      timeout: this.timeout,
      createdAt: new Date(),
    };
  }

  /**
   * Get the task IDs of the last added task(s)
   */
  getLastTaskIds(): string[] {
    return [...this.lastTaskIds];
  }

  /**
   * Get all task IDs
   */
  getAllTaskIds(): string[] {
    return this.tasks.map((t) => t.id);
  }

  /**
   * Internal helper to create a task
   */
  private createTask(
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
}

/**
 * Quick helper to create a research pipeline
 */
export function createResearchPipeline(
  correlationId: string,
  phoneNumber: string,
  options?: {
    linkedinUrl?: string;
    companyName?: string;
    email?: string;
    skipQualification?: boolean;
    skipCrm?: boolean;
  }
): ParallelTaskGroup {
  const builder = ParallelTaskBuilder.create();

  // Research and optionally CRM in parallel
  if (options?.skipCrm) {
    builder.research(phoneNumber, {
      linkedinUrl: options.linkedinUrl,
      companyName: options.companyName,
      email: options.email,
    });
  } else {
    builder.researchAndSync(phoneNumber, {
      linkedinUrl: options?.linkedinUrl,
      companyName: options?.companyName,
      email: options?.email,
    });
  }

  // Add qualification after research
  if (!options?.skipQualification) {
    builder.thenQualify(phoneNumber);
  }

  return builder.waitAll().build(correlationId);
}

/**
 * Quick helper to create background tasks
 */
export function createBackgroundTasks(
  correlationId: string,
  phoneNumber: string,
  options: {
    research?: boolean;
    crm?: boolean;
    video?: { firstName: string; script?: string };
    voice?: { text: string };
  }
): ParallelTaskGroup {
  const builder = ParallelTaskBuilder.create();

  if (options.research) {
    builder.research(phoneNumber);
  }

  if (options.crm) {
    builder.crmSync(phoneNumber);
  }

  if (options.video) {
    builder.generateVideo(phoneNumber, options.video.firstName, options.video.script);
  }

  if (options.voice) {
    builder.generateVoice(phoneNumber, options.voice.text);
  }

  return builder.fireAndForget().build(correlationId);
}

/**
 * Quick helper for media generation pipeline
 */
export function createMediaPipeline(
  correlationId: string,
  phoneNumber: string,
  firstName: string,
  options?: {
    videoScript?: string;
    voiceText?: string;
  }
): ParallelTaskGroup {
  const builder = ParallelTaskBuilder.create();

  builder.generateMedia(phoneNumber, firstName, options?.voiceText);

  return builder.fireAndForget().build(correlationId);
}
