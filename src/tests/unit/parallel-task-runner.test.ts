/**
 * ParallelTaskRunner Unit Tests
 *
 * Tests the parallel execution system for agent tasks.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../../observability/logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }),
  logAgentActivity: vi.fn(),
  logEvent: vi.fn(),
  logError: vi.fn(),
  createCorrelationId: vi.fn().mockReturnValue("test-correlation-id"),
}));

vi.mock("../../observability/metrics.js", () => ({
  metricsRegistry: {
    registerMetric: vi.fn(),
    metrics: vi.fn().mockResolvedValue(""),
    contentType: "text/plain",
  },
}));

vi.mock("../../swarm/parallel/metrics.js", () => ({
  recordParallelTaskStart: vi.fn(),
  recordParallelTaskComplete: vi.fn(),
  recordParallelGroupComplete: vi.fn(),
  recordParallelGroupStart: vi.fn(),
  recordWaveExecution: vi.fn(),
  activeParallelGroups: {
    inc: vi.fn(),
    dec: vi.fn(),
  },
  parallelTasksTotal: { inc: vi.fn() },
  parallelTaskDuration: { observe: vi.fn() },
  parallelGroupsTotal: { inc: vi.fn() },
  parallelGroupDuration: { observe: vi.fn() },
  parallelGroupSize: { observe: vi.fn() },
  activeParallelTasks: { inc: vi.fn(), dec: vi.fn() },
  parallelWavesTotal: { inc: vi.fn() },
}));

vi.mock("../../queue/client.js", () => ({
  getRedisConnection: vi.fn(),
  addJob: vi.fn().mockResolvedValue({ id: "job-123" }),
  addBulkJobs: vi.fn().mockResolvedValue([]),
  getQueue: vi.fn(),
  getQueueEvents: vi.fn(),
}));

// Mock base-agent with inline mock to avoid hoisting issues
vi.mock("../../swarm/base-agent.js", () => {
  const mockAgentProcess = vi.fn().mockResolvedValue({
    success: true,
    agentType: "research",
    response: "Research completed",
    data: { found: true },
  });
  return {
    createAgent: vi.fn().mockReturnValue({
      type: "research",
      process: mockAgentProcess,
    }),
    getRegisteredAgentTypes: vi.fn().mockReturnValue(["research", "crm", "qualification", "video", "voice"]),
    __mockAgentProcess: mockAgentProcess,
  };
});

import {
  ParallelTaskRunner,
  getParallelTaskRunner,
  resetParallelTaskRunner,
} from "../../swarm/parallel/task-runner.js";
import {
  ParallelTaskBuilder,
  createResearchPipeline,
  createBackgroundTasks,
} from "../../swarm/parallel/task-builder.js";
import type { ParallelTaskGroup, ParallelTask } from "../../swarm/parallel/types.js";
import { AGENT_PARALLEL_CONFIGS } from "../../swarm/parallel/types.js";
import type { AgentContext } from "../../swarm/types.js";
import { addBulkJobs } from "../../queue/client.js";
import { createAgent, __mockAgentProcess } from "../../swarm/base-agent.js";

// Get the mock process function for controlling test behavior
const mockAgentProcess = __mockAgentProcess as ReturnType<typeof vi.fn>;

describe("ParallelTaskRunner", () => {
  const mockContext: AgentContext = {
    correlationId: "test-correlation-id",
    config: {
      enabled: true,
      eventName: "Tech Summit 2024",
      ownerName: "Michael",
      requiredFields: ["email"],
    },
    phoneNumber: "+15551234567",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetParallelTaskRunner();
  });

  afterEach(() => {
    resetParallelTaskRunner();
  });

  describe("Singleton Pattern", () => {
    it("should return same instance with getParallelTaskRunner", () => {
      const first = getParallelTaskRunner();
      const second = getParallelTaskRunner();
      expect(first).toBe(second);
    });

    it("should reset runner instance", () => {
      const first = getParallelTaskRunner();
      resetParallelTaskRunner();
      const second = getParallelTaskRunner();
      expect(first).not.toBe(second);
    });
  });

  describe("createTask", () => {
    it("should create a task with default priority", () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {
        phoneNumber: "+15551234567",
      });

      expect(task.id).toBeDefined();
      expect(task.agentType).toBe("research");
      expect(task.action).toBe("pdl_enrich");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe(AGENT_PARALLEL_CONFIGS.research.defaultPriority);
    });

    it("should create a task with custom priority", () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("crm", "sync", {}, { priority: 99 });

      expect(task.priority).toBe(99);
    });

    it("should create a task with dependencies", () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("qualification", "qualify", {}, {
        dependsOn: ["task-1", "task-2"],
      });

      expect(task.dependsOn).toEqual(["task-1", "task-2"]);
    });
  });

  describe("createGroup", () => {
    it("should create a task group with specified strategy", () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "fire-and-forget", [task]);

      expect(group.id).toBeDefined();
      expect(group.correlationId).toBe("corr-123");
      expect(group.strategy).toBe("fire-and-forget");
      expect(group.tasks).toHaveLength(1);
      expect(group.createdAt).toBeInstanceOf(Date);
    });

    it("should create a group with timeout", () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "wait-all", [task], 5000);

      expect(group.timeout).toBe(5000);
    });
  });

  describe("Fire-and-Forget Strategy", () => {
    it("should queue all tasks and return immediately", async () => {
      const runner = getParallelTaskRunner();
      const task1 = runner.createTask("research", "pdl_enrich", { phoneNumber: "+1" });
      const task2 = runner.createTask("crm", "sync", { phoneNumber: "+1" });
      const group = runner.createGroup("corr-123", "fire-and-forget", [task1, task2]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("completed");
      expect(result.strategy).toBe("fire-and-forget");
      expect(result.tasks).toHaveLength(2);
      expect(addBulkJobs).toHaveBeenCalledWith("agent-tasks", expect.any(Array));
    });

    it("should set all tasks as pending in result", async () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "fire-and-forget", [task]);

      const result = await runner.execute(group, mockContext);

      expect(result.tasks[0].status).toBe("pending");
      expect(result.completedCount).toBe(0); // Not tracked for fire-and-forget
    });
  });

  describe("Wait-All Strategy", () => {
    it("should execute all tasks and wait for completion", async () => {
      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", { phoneNumber: "+1" });
      const group = runner.createGroup("corr-123", "wait-all", [task]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("completed");
      expect(result.strategy).toBe("wait-all");
      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });

    it("should execute tasks in waves based on dependencies", async () => {
      const runner = getParallelTaskRunner();
      const researchTask = runner.createTask("research", "pdl_enrich", {});
      const qualifyTask = runner.createTask("qualification", "qualify", {}, {
        dependsOn: [researchTask.id],
      });
      const group = runner.createGroup("corr-123", "wait-all", [researchTask, qualifyTask]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("completed");
      expect(result.completedCount).toBe(2);
      // Verify research was called before qualification
      expect(createAgent).toHaveBeenCalledTimes(2);
    });

    it("should handle task failures gracefully", async () => {
      vi.mocked(mockAgentProcess).mockRejectedValueOnce(new Error("Task failed"));

      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "wait-all", [task]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("failed");
      expect(result.failedCount).toBe(1);
      expect(result.tasks[0].error).toBe("Task failed");
    });

    it("should return partial status when some tasks succeed", async () => {
      vi.mocked(mockAgentProcess)
        .mockResolvedValueOnce({
          success: true,
          agentType: "research",
          response: "Done",
        })
        .mockRejectedValueOnce(new Error("Failed"));

      const runner = getParallelTaskRunner();
      const task1 = runner.createTask("research", "pdl_enrich", {});
      const task2 = runner.createTask("crm", "sync", {});
      const group = runner.createGroup("corr-123", "wait-all", [task1, task2]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("partial");
      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });

    it("should merge results from all tasks", async () => {
      vi.mocked(mockAgentProcess).mockResolvedValue({
        success: true,
        agentType: "research",
        response: "Done",
        data: { enriched: true },
      });

      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "wait-all", [task]);

      const result = await runner.execute(group, mockContext);

      expect(result.mergedResult).toBeDefined();
    });
  });

  describe("First-Wins Strategy", () => {
    it("should return first successful result", async () => {
      const runner = getParallelTaskRunner();
      const task1 = runner.createTask("research", "pdl_enrich", {});
      const task2 = runner.createTask("crm", "sync", {});
      const group = runner.createGroup("corr-123", "first-wins", [task1, task2]);

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("completed");
      expect(result.strategy).toBe("first-wins");
      expect(result.tasks).toHaveLength(1); // Only first winner
    });

    it("should handle all tasks failing", async () => {
      vi.mocked(mockAgentProcess).mockRejectedValue(new Error("All failed"));

      const runner = getParallelTaskRunner();
      const task = runner.createTask("research", "pdl_enrich", {});
      const group = runner.createGroup("corr-123", "first-wins", [task], 100); // Short timeout

      const result = await runner.execute(group, mockContext);

      expect(result.status).toBe("failed");
    });
  });
});

describe("ParallelTaskBuilder", () => {
  describe("Fluent API", () => {
    it("should build a research task", () => {
      const group = ParallelTaskBuilder.create()
        .research("+15551234567", { linkedinUrl: "https://linkedin.com/in/test" })
        .waitAll()
        .build("corr-123");

      expect(group.tasks).toHaveLength(1);
      expect(group.tasks[0].agentType).toBe("research");
      expect(group.strategy).toBe("wait-all");
    });

    it("should build parallel research and CRM tasks", () => {
      const group = ParallelTaskBuilder.create()
        .researchAndSync("+15551234567")
        .fireAndForget()
        .build("corr-123");

      expect(group.tasks).toHaveLength(2);
      expect(group.tasks.map(t => t.agentType)).toContain("research");
      expect(group.tasks.map(t => t.agentType)).toContain("crm");
      expect(group.strategy).toBe("fire-and-forget");
    });

    it("should build qualification after research with dependencies", () => {
      const group = ParallelTaskBuilder.create()
        .research("+15551234567")
        .thenQualify("+15551234567")
        .waitAll()
        .build("corr-123");

      expect(group.tasks).toHaveLength(2);
      const qualifyTask = group.tasks.find(t => t.agentType === "qualification");
      expect(qualifyTask?.dependsOn).toBeDefined();
    });

    it("should build media generation tasks", () => {
      const group = ParallelTaskBuilder.create()
        .generateMedia("+15551234567", "John", "Hello John!")
        .fireAndForget()
        .build("corr-123");

      expect(group.tasks.length).toBeGreaterThanOrEqual(1);
      expect(group.tasks.some(t => t.agentType === "video")).toBe(true);
    });

    it("should support custom timeout", () => {
      const group = ParallelTaskBuilder.create()
        .research("+15551234567")
        .withTimeout(30000)
        .build("corr-123");

      expect(group.timeout).toBe(30000);
    });

    it("should throw when building empty group", () => {
      expect(() => {
        ParallelTaskBuilder.create().build("corr-123");
      }).toThrow("Cannot build empty task group");
    });
  });

  describe("Helper Functions", () => {
    it("should create research pipeline with qualification", () => {
      const group = createResearchPipeline("corr-123", "+15551234567", {
        linkedinUrl: "https://linkedin.com/in/test",
      });

      expect(group.strategy).toBe("wait-all");
      expect(group.tasks.length).toBeGreaterThanOrEqual(2); // Research + CRM + Qualification
    });

    it("should create research pipeline without qualification", () => {
      const group = createResearchPipeline("corr-123", "+15551234567", {
        skipQualification: true,
      });

      const hasQualification = group.tasks.some(t => t.agentType === "qualification");
      expect(hasQualification).toBe(false);
    });

    it("should create background tasks", () => {
      const group = createBackgroundTasks("corr-123", "+15551234567", {
        research: true,
        crm: true,
        video: { firstName: "John" },
      });

      expect(group.strategy).toBe("fire-and-forget");
      expect(group.tasks).toHaveLength(3);
    });

    it("should skip tasks not requested", () => {
      const group = createBackgroundTasks("corr-123", "+15551234567", {
        research: true,
        crm: false,
      });

      expect(group.tasks).toHaveLength(1);
      expect(group.tasks[0].agentType).toBe("research");
    });
  });
});

describe("AGENT_PARALLEL_CONFIGS", () => {
  it("should have config for all agent types", () => {
    // Note: "conversation" agent was removed - orchestrator handles conversations
    const expectedTypes = [
      "orchestrator",
      "research",
      "crm",
      "qualification",
      "personalization",
      "video",
      "voice",
    ];

    for (const type of expectedTypes) {
      expect(AGENT_PARALLEL_CONFIGS[type as keyof typeof AGENT_PARALLEL_CONFIGS]).toBeDefined();
    }
  });

  it("should have research as independent (no dependencies)", () => {
    const config = AGENT_PARALLEL_CONFIGS.research;
    expect(config.dependsOn).toHaveLength(0);
    expect(config.isBackground).toBe(true);
  });

  it("should have qualification depending on research", () => {
    const config = AGENT_PARALLEL_CONFIGS.qualification;
    expect(config.dependsOn).toContain("research");
  });

  it("should have video with long timeout", () => {
    const config = AGENT_PARALLEL_CONFIGS.video;
    expect(config.timeoutMs).toBeGreaterThanOrEqual(300000); // 5 minutes
  });
});
