/**
 * SwarmOrchestrator Unit Tests
 *
 * Tests the AI-powered orchestrator that uses Claude directly.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing orchestrator
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
  recordAgentExecution: vi.fn(),
  activeAgents: {
    inc: vi.fn(),
    dec: vi.fn(),
  },
  startTimer: vi.fn().mockReturnValue(() => 100),
  metricsRegistry: {
    registerMetric: vi.fn(),
    metrics: vi.fn().mockResolvedValue(""),
    contentType: "text/plain",
  },
}));

vi.mock("../../queue/client.js", () => ({
  getRedisConnection: vi.fn(),
  addJob: vi.fn().mockResolvedValue({ id: "job-123" }),
}));

vi.mock("../../contacts/index.js", () => ({
  findContactByPhone: vi.fn(),
  updateContactByPhone: vi.fn().mockResolvedValue({ success: true }),
  deleteContactByPhone: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../contacts/state-machine.js", () => ({
  getMissingRequiredFields: vi.fn().mockReturnValue([]),
}));

vi.mock("../../agent/prompts.js", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("Mock system prompt"),
  buildContactContext: vi.fn().mockReturnValue("Mock contact context"),
}));

// Mock parallel execution module
vi.mock("../../swarm/parallel/index.js", () => ({
  ParallelTaskRunner: class MockParallelTaskRunner {
    execute = vi.fn().mockResolvedValue({
      groupId: "group-123",
      strategy: "fire-and-forget",
      status: "completed",
      tasks: [],
      durationMs: 100,
      completedCount: 0,
      failedCount: 0,
    });
    createTask = vi.fn().mockReturnValue({
      id: "task-123",
      agentType: "research",
      action: "pdl_enrich",
      input: {},
      priority: 50,
      status: "pending",
    });
    createGroup = vi.fn().mockReturnValue({
      id: "group-123",
      correlationId: "test",
      strategy: "fire-and-forget",
      tasks: [],
      createdAt: new Date(),
    });
  },
  getParallelTaskRunner: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue({
      groupId: "group-123",
      strategy: "fire-and-forget",
      status: "completed",
      tasks: [],
      durationMs: 100,
      completedCount: 0,
      failedCount: 0,
    }),
  }),
  createBackgroundTasks: vi.fn().mockReturnValue({
    id: "group-123",
    correlationId: "test",
    strategy: "fire-and-forget",
    tasks: [],
    createdAt: new Date(),
  }),
  createResearchPipeline: vi.fn().mockReturnValue({
    id: "group-123",
    correlationId: "test",
    strategy: "wait-all",
    tasks: [],
    createdAt: new Date(),
  }),
  AGENT_PARALLEL_CONFIGS: {},
}));

// Mock LLM client - define response inline to avoid hoisting issues
vi.mock("../../swarm/llm/client.js", () => {
  const mockResponse = {
    content: "Hello! How can I help you today?",
    usage: { inputTokens: 100, outputTokens: 50 },
    toolCalls: undefined,
  };
  return {
    getLLMClient: vi.fn().mockReturnValue({
      runWithTools: vi.fn().mockResolvedValue(mockResponse),
      complete: vi.fn().mockResolvedValue(mockResponse),
      isConfigured: vi.fn().mockReturnValue(true),
    }),
  };
});

vi.mock("../../swarm/llm/tool-executor.js", () => ({
  ToolExecutor: class MockToolExecutor {
    registerTool = vi.fn();
    executeTool = vi.fn().mockResolvedValue({ result: { success: true } });
    getToolDefinitions = vi.fn().mockReturnValue([]);
  },
  defineTool: vi.fn().mockImplementation((name, desc, props, req) => ({
    name,
    description: desc,
    inputSchema: { type: "object", properties: props, required: req },
  })),
}));

import {
  SwarmOrchestrator,
  getOrchestrator,
  resetOrchestrator,
} from "../../swarm/orchestrator.js";
import { getRedisConnection, addJob } from "../../queue/client.js";
import { getLLMClient } from "../../swarm/llm/client.js";
import { findContactByPhone } from "../../contacts/index.js";
import type { NetworkingEventConfig, NetworkingContact } from "../../config/types.js";

describe("SwarmOrchestrator", () => {
  const mockConfig: NetworkingEventConfig = {
    enabled: true,
    eventName: "Tech Summit 2024",
    ownerName: "Michael",
    requiredFields: ["email", "company_name", "job_title"],
    calendly: {
      schedulingLink: "https://calendly.com/michael/30min",
    },
  };

  const mockContact: NetworkingContact = {
    id: "contact-123",
    phone_number: "+15551234567",
    first_name: "Jane",
    last_name: "Doe",
    email: "jane@example.com",
    company_name: "Test Corp",
    job_title: "Engineer",
    status: "qualified",
    created_at: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetOrchestrator();
  });

  afterEach(() => {
    resetOrchestrator();
  });

  describe("Constructor and Initialization", () => {
    it("should initialize with event config", () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);
      expect(orchestrator).toBeDefined();
    });

    it("should initialize with custom orchestrator config", () => {
      const customConfig = {
        maxConversationTurns: 10,
        stateExpirySecs: 3600,
      };
      const orchestrator = new SwarmOrchestrator(mockConfig, customConfig);
      expect(orchestrator).toBeDefined();
    });

    it("should register tools on initialization", () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);
      // Tools are registered internally
      expect(orchestrator).toBeDefined();
    });
  });

  describe("processMessage", () => {
    it("should process a simple message successfully", async () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!",
        "whatsapp",
        mockContact
      );

      expect(result.success).toBe(true);
      expect(result.agentType).toBe("orchestrator");
      expect(result.response).toBe("Hello! How can I help you today?");
    });

    it("should use default channel when not specified", async () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(true);
    });

    it("should include token usage in result", async () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!",
        "whatsapp",
        mockContact
      );

      expect(result.tokensUsed).toEqual({ input: 100, output: 50 });
    });

    it("should handle LLM errors gracefully", async () => {
      const mockLLM = getLLMClient();
      vi.mocked(mockLLM.runWithTools).mockRejectedValueOnce(new Error("LLM error"));

      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("LLM error");
    });
  });

  describe("State Management", () => {
    it("should create new state when Redis unavailable", async () => {
      vi.mocked(getRedisConnection).mockReturnValue(null);

      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(true);
    });

    it("should load existing state from Redis", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(JSON.stringify({
          correlationId: "existing-id",
          phoneNumber: "+15551234567",
          channel: "whatsapp",
          conversationTurns: 5,
          lastActivityAt: new Date().toISOString(),
          taskQueue: [],
          completedTasks: [],
        })),
        setex: vi.fn().mockResolvedValue("OK"),
        keys: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith("swarm:state:+15551234567");
    });

    it("should save state to Redis after processing", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue("OK"),
        keys: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const orchestrator = new SwarmOrchestrator(mockConfig);

      await orchestrator.processMessage("+15551234567", "Hello!");

      expect(mockRedis.setex).toHaveBeenCalled();
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      expect(key).toBe("swarm:state:+15551234567");
      expect(ttl).toBe(86400); // Default 24 hours

      const savedState = JSON.parse(value);
      expect(savedState.conversationTurns).toBe(1);
    });

    it("should handle Redis get error gracefully", async () => {
      const mockRedis = {
        get: vi.fn().mockRejectedValue(new Error("Redis error")),
        setex: vi.fn().mockResolvedValue("OK"),
        keys: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const orchestrator = new SwarmOrchestrator(mockConfig);

      // Should not throw, should create new state
      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(true);
    });

    it("should handle Redis save error gracefully", async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockRejectedValue(new Error("Redis error")),
        keys: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const orchestrator = new SwarmOrchestrator(mockConfig);

      // Should not throw
      const result = await orchestrator.processMessage(
        "+15551234567",
        "Hello!"
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Tool Execution", () => {
    it("should execute tools when LLM requests them", async () => {
      const mockLLM = getLLMClient();
      vi.mocked(mockLLM.runWithTools).mockImplementationOnce(async (request, executor) => {
        // Simulate tool call
        await executor({
          id: "tool-call-1",
          name: "contact_lookup",
          input: { phoneNumber: "+15551234567" },
        });
        return {
          content: "I found your contact!",
          usage: { inputTokens: 100, outputTokens: 50 },
          toolCalls: [{ id: "tool-call-1", name: "contact_lookup", input: {} }],
        };
      });

      const orchestrator = new SwarmOrchestrator(mockConfig);

      const result = await orchestrator.processMessage(
        "+15551234567",
        "Look up my info"
      );

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
    });
  });

  describe("Utility Methods", () => {
    it("should check if operational when LLM configured", () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);
      expect(orchestrator.isOperational()).toBe(true);
    });

    it("should return available agents as just orchestrator", () => {
      const orchestrator = new SwarmOrchestrator(mockConfig);
      expect(orchestrator.getAvailableAgents()).toEqual(["orchestrator"]);
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance with getOrchestrator", () => {
      const first = getOrchestrator(mockConfig);
      const second = getOrchestrator();

      expect(first).toBe(second);
    });

    it("should throw when getting orchestrator without config on first call", () => {
      expect(() => getOrchestrator()).toThrow("Event config required");
    });

    it("should reset orchestrator instance", () => {
      const first = getOrchestrator(mockConfig);
      resetOrchestrator();
      const second = getOrchestrator(mockConfig);

      expect(first).not.toBe(second);
    });
  });
});
