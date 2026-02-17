/**
 * Voice Message Flow Integration Test
 *
 * Tests that:
 * 1. When user sends a voice message, voice mode is auto-enabled
 * 2. The orchestrator responds with voice (calls send_voice_response)
 * 3. When user asks for text, voice mode is disabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOrchestrator, resetOrchestrator } from "../../swarm/orchestrator.js";
import type { NetworkingEventConfig, NetworkingContact } from "../../config/types.js";

// Mock Redis
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock("../../queue/client.js", () => ({
  getRedisConnection: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
  }),
  checkRedisHealth: () => Promise.resolve({ connected: true }),
  addJob: vi.fn(),
}));

// Mock LLM client
const mockRunWithTools = vi.fn();
vi.mock("../../swarm/llm/client.js", () => ({
  getLLMClient: () => ({
    runWithTools: mockRunWithTools,
  }),
  createLLMClient: vi.fn(),
  DEFAULT_MODEL: "claude-sonnet-4-20250514",
}));

// Mock database
vi.mock("../../database/client.js", () => ({
  getDatabase: () => null,
  isDatabaseConfigured: () => false,
}));

// Mock ElevenLabs
vi.mock("../../integrations/elevenlabs/client.js", () => ({
  generateVoiceMessage: vi.fn().mockResolvedValue({
    status: "completed",
    audioData: Buffer.from("mock-audio"),
  }),
}));

// Mock media store
vi.mock("../../storage/media-store.js", () => ({
  getMediaStore: () => ({
    store: vi.fn().mockResolvedValue({
      success: true,
      storageKey: "voice/123/test.ogg",
    }),
    getLocalPath: vi.fn().mockReturnValue("/tmp/voice/test.ogg"),
  }),
}));

// Mock prom-client first (before metrics imports)
vi.mock("prom-client", () => ({
  Counter: vi.fn().mockImplementation(() => ({
    inc: vi.fn(),
    labels: vi.fn().mockReturnThis(),
  })),
  Histogram: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    startTimer: vi.fn().mockReturnValue(() => 0),
    labels: vi.fn().mockReturnThis(),
  })),
  Gauge: vi.fn().mockImplementation(() => ({
    inc: vi.fn(),
    dec: vi.fn(),
    set: vi.fn(),
    labels: vi.fn().mockReturnThis(),
  })),
  Registry: vi.fn().mockImplementation(() => ({
    registerMetric: vi.fn(),
    getSingleMetric: vi.fn(),
    metrics: vi.fn().mockResolvedValue(""),
    contentType: "text/plain",
  })),
}));

// Mock metrics
vi.mock("../../observability/metrics.js", () => ({
  metricsRegistry: {
    getSingleMetric: () => null,
    registerMetric: vi.fn(),
  },
  startTimer: () => () => 0,
  recordAgentExecution: vi.fn(),
  activeAgents: {
    inc: vi.fn(),
    dec: vi.fn(),
  },
}));

// Mock parallel metrics
vi.mock("../../swarm/parallel/metrics.js", () => ({
  parallelTasksTotal: { inc: vi.fn() },
  parallelTaskDuration: { observe: vi.fn() },
  parallelGroupsTotal: { inc: vi.fn() },
  parallelGroupDuration: { observe: vi.fn() },
  parallelGroupSize: { observe: vi.fn() },
  activeParallelGroups: { inc: vi.fn(), dec: vi.fn() },
  activeParallelTasks: { inc: vi.fn(), dec: vi.fn() },
  parallelWavesTotal: { inc: vi.fn() },
  recordParallelTaskStart: vi.fn(),
  recordParallelTaskComplete: vi.fn(),
  recordParallelGroupComplete: vi.fn(),
  recordParallelGroupStart: vi.fn(),
  recordWaveExecution: vi.fn(),
}));

// Mock activity store
vi.mock("../../history/activity-store.js", () => ({
  getActivityStore: () => ({
    startActivity: vi.fn().mockResolvedValue("activity-id"),
    completeActivity: vi.fn(),
  }),
}));

const TEST_CONFIG: NetworkingEventConfig = {
  enabled: true,
  eventName: "Test Event",
  ownerName: "Test Owner",
  requiredFields: ["email", "company_name"],
  calendly: {
    schedulingLink: "https://calendly.com/test",
  },
  swarm: {
    enabled: true,
    rolloutPercentage: 100,
  },
  elevenlabs: {
    apiKey: "test-api-key",
    voiceId: "test-voice-id",
  },
};

const TEST_CONTACT: NetworkingContact = {
  id: "contact-123",
  phone_number: "17541234567",
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  status: "active",
  created_at: new Date().toISOString(),
};

describe("Voice Message Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOrchestrator();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  afterEach(() => {
    resetOrchestrator();
  });

  describe("Voice Mode Auto-Enable", () => {
    it("should auto-enable voice mode when user sends voice message", async () => {
      // Mock LLM to return a simple text response
      mockRunWithTools.mockResolvedValue({
        content: "Hello! How can I help you?",
        stopReason: "end_turn",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Hello, this is a voice message transcription",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: true }
      );

      // Should have set voice mode in Redis
      expect(mockRedisSet).toHaveBeenCalledWith(
        "voice_mode:17541234567",
        "true",
        "EX",
        86400
      );
    });

    it("should NOT auto-enable voice mode for text messages", async () => {
      mockRunWithTools.mockResolvedValue({
        content: "Hello! How can I help you?",
        stopReason: "end_turn",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Hello, this is a text message",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: false }
      );

      // Should NOT have set voice mode (it checks existing value but doesn't set)
      expect(mockRedisSet).not.toHaveBeenCalledWith(
        "voice_mode:17541234567",
        "true",
        expect.anything(),
        expect.anything()
      );
    });

    it("should check existing voice mode for text messages", async () => {
      mockRunWithTools.mockResolvedValue({
        content: "Hello!",
        stopReason: "end_turn",
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Hello",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: false }
      );

      // Should have checked Redis for existing voice mode
      expect(mockRedisGet).toHaveBeenCalledWith("voice_mode:17541234567");
    });
  });

  describe("System Prompt for Voice Mode", () => {
    it("should include voice mode ENABLED instructions when voice message received", async () => {
      let capturedSystemPrompt = "";

      mockRunWithTools.mockImplementation(async (request) => {
        capturedSystemPrompt = request.systemPrompt;
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Voice transcription",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: true }
      );

      // Should include voice mode ENABLED instructions
      expect(capturedSystemPrompt).toContain("Voice Mode: ENABLED");
      expect(capturedSystemPrompt).toContain("send_voice_response");
      expect(capturedSystemPrompt).toContain("user sent voice message");
    });

    it("should include voice mode DISABLED instructions for text messages", async () => {
      let capturedSystemPrompt = "";

      mockRunWithTools.mockImplementation(async (request) => {
        capturedSystemPrompt = request.systemPrompt;
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Text message",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: false }
      );

      // Should include voice mode DISABLED instructions
      expect(capturedSystemPrompt).toContain("Voice Mode: DISABLED");
    });

    it("should instruct Claude to use send_voice_response tool in voice mode", async () => {
      let capturedSystemPrompt = "";

      mockRunWithTools.mockImplementation(async (request) => {
        capturedSystemPrompt = request.systemPrompt;
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Voice transcription",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: true }
      );

      // Should tell Claude to ALWAYS respond with voice
      expect(capturedSystemPrompt).toContain("MUST use the send_voice_response tool");
      expect(capturedSystemPrompt).toContain("ALL your responses");
    });
  });

  describe("Voice Mode Toggle", () => {
    it("should instruct Claude how to disable voice mode when user asks for text", async () => {
      let capturedSystemPrompt = "";

      mockRunWithTools.mockImplementation(async (request) => {
        capturedSystemPrompt = request.systemPrompt;
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Voice transcription",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: true }
      );

      // Should include instructions for switching back to text
      expect(capturedSystemPrompt).toContain("text");
      expect(capturedSystemPrompt).toContain("write to me");
      expect(capturedSystemPrompt).toContain("set_voice_mode");
    });
  });

  describe("Orchestrator Tools", () => {
    it("should have send_voice_response tool available", async () => {
      let capturedTools: any[] = [];

      mockRunWithTools.mockImplementation(async (request) => {
        capturedTools = request.tools || [];
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Hello",
        "whatsapp",
        TEST_CONTACT,
        { isVoiceMessage: true }
      );

      const toolNames = capturedTools.map((t) => t.name);
      expect(toolNames).toContain("send_voice_response");
    });

    it("should have set_voice_mode tool available", async () => {
      let capturedTools: any[] = [];

      mockRunWithTools.mockImplementation(async (request) => {
        capturedTools = request.tools || [];
        return {
          content: "Response",
          stopReason: "end_turn",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      });

      const orchestrator = getOrchestrator(TEST_CONFIG);

      await orchestrator.processMessage(
        "17541234567",
        "Hello",
        "whatsapp",
        TEST_CONTACT
      );

      const toolNames = capturedTools.map((t) => t.name);
      expect(toolNames).toContain("set_voice_mode");
    });
  });
});

describe("Voice Response Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOrchestrator();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue("OK");
  });

  afterEach(() => {
    resetOrchestrator();
  });

  it("should have ElevenLabs config validation", async () => {
    mockRunWithTools.mockResolvedValue({
      content: "Hello!",
      stopReason: "end_turn",
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const configWithoutElevenLabs: NetworkingEventConfig = {
      ...TEST_CONFIG,
      elevenlabs: undefined,
    };

    const orchestrator = getOrchestrator(configWithoutElevenLabs);

    // Should still work but voice tool would fail gracefully
    const result = await orchestrator.processMessage(
      "17541234567",
      "Hello",
      "whatsapp",
      TEST_CONTACT,
      { isVoiceMessage: true }
    );

    expect(result).toBeDefined();
  });
});

/**
 * Full Voice-to-Voice E2E tests are in scripts/test-voice-e2e.ts
 *
 * Run with: npm run test:voice:e2e
 *
 * These tests use real WhatsApp sessions, Redis, and optionally ElevenLabs
 * to test the complete voice message flow.
 */
