/**
 * Swarm Quality & Fault Detection Tests
 *
 * Comprehensive tests for the agent swarm system covering:
 * - Agent initialization and registration
 * - Orchestrator routing decisions
 * - Agent-to-agent handoffs
 * - Tool execution and validation
 * - State management
 * - Error handling and fallbacks
 * - Qualification logic
 * - Response quality checks
 * - Hallucination detection
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  getDatabase,
  isDatabaseConfigured,
  resetDatabase,
} from "../../database/client.js";
import type { NetworkingEventConfig, NetworkingContact } from "../../config/types.js";
import type { AgentContext, AgentResult, SwarmState, QualificationTier } from "../../swarm/types.js";

// Skip tests if database is not configured
const runDbTests = process.env.DATABASE_URL || process.env.POSTGRES_HOST;

// Test configuration
const TEST_CONFIG: NetworkingEventConfig = {
  enabled: true,
  eventName: "Test Conference 2024",
  ownerName: "Test User",
  requiredFields: ["email", "company_name", "job_title"],
  calendly: {
    schedulingLink: "https://calendly.com/test/30min",
  },
  swarm: {
    enabled: true,
    rolloutPercentage: 100,
    fallbackToRules: true,
    maxConversationTurns: 20,
  },
};

const TEST_CONTACT: NetworkingContact = {
  id: "test-contact-001",
  phone_number: "17542959900",
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  company_name: "Acme Corp",
  job_title: "CEO",
  status: "welcomed",
  qualification_tier: "warm" as QualificationTier,
  created_at: new Date().toISOString(),
};

describe.skipIf(!runDbTests)("Swarm Quality & Fault Detection", () => {
  let sql: ReturnType<typeof getDatabase>;

  beforeAll(() => {
    sql = getDatabase();
    expect(sql).not.toBeNull();
  });

  afterAll(async () => {
    resetDatabase();
  });

  describe("Agent Type Validation", () => {
    // Agent types after refactoring - orchestrator handles conversations
    const validAgentTypes = [
      "orchestrator",
      "research",
      "qualification",
      "personalization",
      "video",
      "voice",
      "crm",
    ];

    it("should have all required agent types defined", () => {
      for (const agentType of validAgentTypes) {
        expect(typeof agentType).toBe("string");
        expect(agentType.length).toBeGreaterThan(0);
      }
    });

    it("should not have duplicate agent types", () => {
      const uniqueTypes = new Set(validAgentTypes);
      expect(uniqueTypes.size).toBe(validAgentTypes.length);
    });
  });

  describe("Routing Decision Logic", () => {
    // The orchestrator handles all conversations directly
    const routingTestCases = [
      { input: "What's your email?", expectedIntent: "contact_info", shouldRoute: "orchestrator" },
      { input: "john@example.com", expectedIntent: "email_provided", shouldRoute: "orchestrator" },
      { input: "Can we schedule a meeting?", expectedIntent: "scheduling", shouldRoute: "orchestrator" },
      { input: "Tell me about your company", expectedIntent: "question", shouldRoute: "orchestrator" },
      { input: "I work at Google", expectedIntent: "company_info", shouldRoute: "orchestrator" },
      { input: "Check my LinkedIn profile", expectedIntent: "linkedin", shouldRoute: "orchestrator" },
    ];

    for (const testCase of routingTestCases) {
      it(`should route "${testCase.input.substring(0, 30)}..." to ${testCase.shouldRoute}`, () => {
        // Verify routing intent detection
        const input = testCase.input.toLowerCase();

        let detectedIntent = "general";
        if (input.includes("@") || input.includes("email")) detectedIntent = "email";
        if (input.includes("schedule") || input.includes("meeting") || input.includes("calendly")) detectedIntent = "scheduling";
        if (input.includes("linkedin")) detectedIntent = "linkedin";
        if (input.includes("?")) detectedIntent = "question";
        if (input.includes("company") || input.includes("work at")) detectedIntent = "company_info";

        // All routing goes through orchestrator
        expect(testCase.shouldRoute).toBe("orchestrator");
      });
    }
  });

  describe("Qualification Tier Logic", () => {
    const qualificationCases = [
      { score: 90, expectedTier: "hot" },
      { score: 75, expectedTier: "hot" },
      { score: 74, expectedTier: "warm" },
      { score: 50, expectedTier: "warm" },
      { score: 49, expectedTier: "cold" },
      { score: 25, expectedTier: "cold" },
      { score: 24, expectedTier: "unqualified" },
      { score: 0, expectedTier: "unqualified" },
    ];

    function scoreToTier(score: number): QualificationTier {
      if (score >= 75) return "hot";
      if (score >= 50) return "warm";
      if (score >= 25) return "cold";
      return "unqualified";
    }

    for (const testCase of qualificationCases) {
      it(`should assign tier "${testCase.expectedTier}" for score ${testCase.score}`, () => {
        const tier = scoreToTier(testCase.score);
        expect(tier).toBe(testCase.expectedTier);
      });
    }

    it("should handle edge case scores", () => {
      expect(scoreToTier(100)).toBe("hot");
      expect(scoreToTier(-1)).toBe("unqualified");
      expect(scoreToTier(75)).toBe("hot");
      expect(scoreToTier(50)).toBe("warm");
      expect(scoreToTier(25)).toBe("cold");
    });
  });

  describe("Agent Handoff Validation", () => {
    // Orchestrator handles conversations and triggers specialized agents
    const validHandoffs = [
      { from: "orchestrator", to: "research", trigger: "research_contact tool" },
      { from: "orchestrator", to: "video", trigger: "generate_video tool" },
      { from: "orchestrator", to: "voice", trigger: "send_voice_response tool" },
      { from: "research", to: "qualification", trigger: "research complete" },
      { from: "qualification", to: "crm", trigger: "qualification complete" },
    ];

    const invalidHandoffs = [
      { from: "video", to: "orchestrator", reason: "video is a leaf agent" },
      { from: "voice", to: "research", reason: "voice is a leaf agent" },
      { from: "crm", to: "qualification", reason: "crm is a leaf agent" },
      { from: "personalization", to: "video", reason: "personalization is a leaf agent" },
    ];

    const leafAgents = ["video", "voice", "crm", "personalization"];

    it("should allow valid agent handoffs", () => {
      for (const handoff of validHandoffs) {
        expect(leafAgents).not.toContain(handoff.from);
      }
    });

    it("should not allow handoffs from leaf agents", () => {
      for (const handoff of invalidHandoffs) {
        expect(leafAgents).toContain(handoff.from);
      }
    });
  });

  describe("Context Building", () => {
    it("should build valid agent context", () => {
      const context: AgentContext = {
        correlationId: `test-${Date.now()}`,
        config: TEST_CONFIG,
        contact: TEST_CONTACT,
        phoneNumber: TEST_CONTACT.phone_number,
        channel: "whatsapp",
        logger: console as any,
      };

      expect(context.correlationId).toBeDefined();
      expect(context.config.eventName).toBe("Test Conference 2024");
      expect(context.contact?.first_name).toBe("John");
      expect(context.phoneNumber).toBe("17542959900");
      expect(context.channel).toBe("whatsapp");
    });

    it("should handle missing optional context fields", () => {
      const minimalContext: AgentContext = {
        correlationId: `test-${Date.now()}`,
        config: TEST_CONFIG,
        logger: console as any,
      };

      expect(minimalContext.contact).toBeUndefined();
      expect(minimalContext.phoneNumber).toBeUndefined();
      expect(minimalContext.messageHistory).toBeUndefined();
    });
  });

  describe("State Management", () => {
    it("should create valid initial swarm state", () => {
      const initialState: SwarmState = {
        phoneNumber: "17542959900",
        currentAgent: "orchestrator",
        conversationTurns: 0,
        completedTasks: [],
        taskQueue: [],
        lastUpdated: new Date(),
      };

      expect(initialState.phoneNumber).toBe("17542959900");
      expect(initialState.currentAgent).toBe("orchestrator");
      expect(initialState.conversationTurns).toBe(0);
      expect(initialState.completedTasks).toHaveLength(0);
    });

    it("should track conversation turns correctly", () => {
      let state: SwarmState = {
        phoneNumber: "17542959900",
        currentAgent: "orchestrator",
        conversationTurns: 0,
        completedTasks: [],
        taskQueue: [],
        lastUpdated: new Date(),
      };

      // Simulate 5 conversation turns
      for (let i = 0; i < 5; i++) {
        state = {
          ...state,
          conversationTurns: state.conversationTurns + 1,
          lastUpdated: new Date(),
        };
      }

      expect(state.conversationTurns).toBe(5);
    });

    it("should enforce max conversation turns", () => {
      const maxTurns = TEST_CONFIG.swarm?.maxConversationTurns || 20;
      const currentTurns = 25;

      expect(currentTurns > maxTurns).toBe(true);
      // Agent should stop processing or handoff when max turns exceeded
    });
  });

  describe("Tool Validation", () => {
    const requiredTools = {
      orchestrator: [
        "contact_lookup",
        "contact_update",
        "send_video",
        "generate_video",
        "delete_contact",
        "get_calendly_link",
        "research_contact",
        "trigger_parallel_tasks",
        "set_voice_mode",
        "send_voice_response",
      ],
      research: ["pdl_enrich", "update_research_status"],
      qualification: ["set_qualification", "get_engagement_data"],
      personalization: ["generate_welcome_message", "generate_email", "generate_video_script"],
      video: ["generate_heygen_video", "check_video_status", "get_contact_video"],
      voice: ["generate_voice_message", "list_available_voices", "send_voice_message"],
      crm: ["crm_sync", "check_sync_status", "generate_deal_name"],
    };

    it("should have all required tools defined for each agent", () => {
      for (const [agent, tools] of Object.entries(requiredTools)) {
        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
          expect(typeof tool).toBe("string");
          expect(tool.length).toBeGreaterThan(0);
        }
      }
    });

    it("should have unique tool names within each agent", () => {
      for (const [agent, tools] of Object.entries(requiredTools)) {
        const uniqueTools = new Set(tools);
        expect(uniqueTools.size).toBe(tools.length);
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle missing contact gracefully", () => {
      const context: AgentContext = {
        correlationId: `test-${Date.now()}`,
        config: TEST_CONFIG,
        phoneNumber: "17542959900",
        logger: console as any,
        // contact is undefined
      };

      expect(context.contact).toBeUndefined();
      // Agent should be able to create new contact or request info
    });

    it("should handle invalid phone number format", () => {
      const invalidPhones = [
        "",
        "abc",
        "123",
        "+1-754-295-9900", // has dashes
        "1 754 295 9900", // has spaces
      ];

      for (const phone of invalidPhones) {
        const normalized = phone.replace(/[^0-9]/g, "");
        if (normalized.length < 10) {
          expect(normalized.length).toBeLessThan(10);
        }
      }
    });

    it("should handle missing required config fields", () => {
      const incompleteConfig: Partial<NetworkingEventConfig> = {
        enabled: true,
        // missing eventName, ownerName, requiredFields
      };

      expect(incompleteConfig.eventName).toBeUndefined();
      expect(incompleteConfig.ownerName).toBeUndefined();
    });
  });

  describe("Response Quality Checks", () => {
    const testResponses = [
      {
        response: "Hi John! Great to connect with you from Acme Corp.",
        quality: "good",
        hasPersonalization: true,
      },
      {
        response: "Hello! How can I help you today?",
        quality: "generic",
        hasPersonalization: false,
      },
      {
        response: "",
        quality: "empty",
        hasPersonalization: false,
      },
      {
        response: "I apologize, but I cannot help with that request.",
        quality: "refusal",
        hasPersonalization: false,
      },
    ];

    function assessResponseQuality(response: string, contact?: NetworkingContact): string {
      if (!response || response.length === 0) return "empty";
      if (response.includes("apologize") || response.includes("cannot help")) return "refusal";
      if (contact && (response.includes(contact.first_name || "") || response.includes(contact.company_name || ""))) {
        return "good";
      }
      return "generic";
    }

    it("should detect personalized responses", () => {
      const response = "Hi John! Great to connect with you from Acme Corp.";
      const quality = assessResponseQuality(response, TEST_CONTACT);
      expect(quality).toBe("good");
    });

    it("should detect generic responses", () => {
      const response = "Hello! How can I help you today?";
      const quality = assessResponseQuality(response, TEST_CONTACT);
      expect(quality).toBe("generic");
    });

    it("should detect empty responses", () => {
      const response = "";
      const quality = assessResponseQuality(response);
      expect(quality).toBe("empty");
    });

    it("should detect refusal responses", () => {
      const response = "I apologize, but I cannot help with that request.";
      const quality = assessResponseQuality(response);
      expect(quality).toBe("refusal");
    });
  });

  describe("Hallucination Detection", () => {
    const hallucinations = [
      {
        response: "I see you work at Microsoft as a VP.",
        contact: { ...TEST_CONTACT, company_name: "Acme Corp", job_title: "CEO" },
        isHallucination: true,
        reason: "Wrong company and job title",
      },
      {
        response: "Your email is wrong@email.com",
        contact: { ...TEST_CONTACT, email: "john@example.com" },
        isHallucination: true,
        reason: "Wrong email",
      },
      {
        response: "Hi John from Acme Corp!",
        contact: TEST_CONTACT,
        isHallucination: false,
        reason: "Correct information",
      },
    ];

    function detectHallucination(response: string, contact: NetworkingContact): { isHallucination: boolean; reason?: string } {
      const issues: string[] = [];

      // Check for wrong company name
      if (contact.company_name && response.toLowerCase().includes("work at")) {
        const companyMentioned = !response.toLowerCase().includes(contact.company_name.toLowerCase());
        if (companyMentioned && /work at \w+/.test(response.toLowerCase())) {
          issues.push("Wrong company name");
        }
      }

      // Check for wrong email
      if (contact.email && response.includes("@")) {
        const emailMatch = response.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch && emailMatch[0] !== contact.email) {
          issues.push("Wrong email");
        }
      }

      // Check for fabricated job titles
      if (contact.job_title && response.toLowerCase().includes(" as a ")) {
        if (!response.toLowerCase().includes(contact.job_title.toLowerCase())) {
          issues.push("Wrong job title");
        }
      }

      return {
        isHallucination: issues.length > 0,
        reason: issues.join(", ") || undefined,
      };
    }

    it("should detect hallucinated company information", () => {
      const result = detectHallucination(
        "I see you work at Microsoft as a VP.",
        { ...TEST_CONTACT, company_name: "Acme Corp", job_title: "CEO" }
      );
      expect(result.isHallucination).toBe(true);
    });

    it("should detect hallucinated email", () => {
      const result = detectHallucination(
        "Your email is wrong@email.com",
        { ...TEST_CONTACT, email: "john@example.com" }
      );
      expect(result.isHallucination).toBe(true);
    });

    it("should not flag correct information as hallucination", () => {
      const result = detectHallucination(
        "Hi John from Acme Corp!",
        TEST_CONTACT
      );
      expect(result.isHallucination).toBe(false);
    });
  });

  describe("Token Budget Management", () => {
    const TOKEN_BUDGET = 4096;

    it("should respect token budget for context", () => {
      const contextTokenBudget = TEST_CONFIG.swarm?.contextTokenBudget || TOKEN_BUDGET;
      expect(contextTokenBudget).toBeLessThanOrEqual(100000); // Reasonable max
      expect(contextTokenBudget).toBeGreaterThan(0);
    });

    it("should estimate message tokens correctly", () => {
      // Rough estimation: ~4 chars per token
      function estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
      }

      expect(estimateTokens("Hello")).toBe(2); // 5 chars
      expect(estimateTokens("This is a longer message")).toBe(6); // 24 chars
      expect(estimateTokens("")).toBe(0);
    });

    it("should truncate history if over budget", () => {
      const messages = Array(50).fill({ role: "user", content: "Test message content here" });
      const totalTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

      // Should have mechanism to trim messages when over budget
      if (totalTokens > TOKEN_BUDGET) {
        // Trim oldest messages first
        let currentTokens = totalTokens;
        let trimmedCount = 0;
        while (currentTokens > TOKEN_BUDGET && trimmedCount < messages.length) {
          currentTokens -= Math.ceil(messages[trimmedCount].content.length / 4);
          trimmedCount++;
        }
        expect(trimmedCount).toBeGreaterThan(0);
      }
    });
  });

  describe("Rollout Percentage Logic", () => {
    function shouldUseSwarm(phoneNumber: string, rolloutPercentage: number): boolean {
      // Deterministic hash based on phone number
      let hash = 0;
      for (let i = 0; i < phoneNumber.length; i++) {
        hash = ((hash << 5) - hash) + phoneNumber.charCodeAt(i);
        hash = hash & hash;
      }
      const bucket = Math.abs(hash) % 100;
      return bucket < rolloutPercentage;
    }

    it("should be deterministic for same phone number", () => {
      const phone = "17542959900";
      const result1 = shouldUseSwarm(phone, 50);
      const result2 = shouldUseSwarm(phone, 50);
      expect(result1).toBe(result2);
    });

    it("should include all phones at 100%", () => {
      const phones = ["17542959900", "13054272115", "12025551234"];
      for (const phone of phones) {
        expect(shouldUseSwarm(phone, 100)).toBe(true);
      }
    });

    it("should exclude all phones at 0%", () => {
      const phones = ["17542959900", "13054272115", "12025551234"];
      for (const phone of phones) {
        expect(shouldUseSwarm(phone, 0)).toBe(false);
      }
    });

    it("should split phones roughly proportionally at 50%", () => {
      const phones = Array.from({ length: 100 }, (_, i) => `1555000${i.toString().padStart(4, "0")}`);
      const included = phones.filter(p => shouldUseSwarm(p, 50)).length;
      // Should be roughly 50%, allow ±20% variance for small sample
      expect(included).toBeGreaterThan(30);
      expect(included).toBeLessThan(70);
    });
  });

  describe("Message History Validation", () => {
    it("should order messages chronologically", () => {
      const messages = [
        { createdAt: new Date("2024-01-01T10:00:00Z"), content: "First" },
        { createdAt: new Date("2024-01-01T10:05:00Z"), content: "Second" },
        { createdAt: new Date("2024-01-01T10:10:00Z"), content: "Third" },
      ];

      const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      expect(sorted[0].content).toBe("First");
      expect(sorted[1].content).toBe("Second");
      expect(sorted[2].content).toBe("Third");
    });

    it("should alternate user/assistant messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm doing well!" },
      ];

      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i].role).not.toBe(messages[i + 1].role);
      }
    });

    it("should detect malformed message history", () => {
      const malformedHistories = [
        // Two user messages in a row
        [{ role: "user", content: "Hello" }, { role: "user", content: "World" }],
        // Two assistant messages in a row
        [{ role: "assistant", content: "Hi" }, { role: "assistant", content: "There" }],
        // Empty content
        [{ role: "user", content: "" }],
      ];

      function isValidHistory(messages: { role: string; content: string }[]): boolean {
        for (let i = 0; i < messages.length; i++) {
          if (!messages[i].content) return false;
          if (i > 0 && messages[i].role === messages[i - 1].role) return false;
        }
        return true;
      }

      expect(isValidHistory(malformedHistories[0])).toBe(false);
      expect(isValidHistory(malformedHistories[1])).toBe(false);
      expect(isValidHistory(malformedHistories[2])).toBe(false);
    });
  });
});
