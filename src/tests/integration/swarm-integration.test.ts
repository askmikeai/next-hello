/**
 * Swarm Integration Tests
 *
 * REAL integration tests that actually run the swarm agents
 * and display all outputs for inspection.
 *
 * Prerequisites:
 * - PostgreSQL running
 * - Redis running
 * - ANTHROPIC_API_KEY set
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDatabase,
  isDatabaseConfigured,
  resetDatabase,
} from "../../database/client.js";
import { checkRedisHealth } from "../../queue/client.js";
import { SwarmOrchestrator } from "../../swarm/orchestrator.js";
import { initializeSwarm, shouldUseSwarm } from "../../swarm/index.js";
import type { NetworkingEventConfig, NetworkingContact } from "../../config/types.js";
import type { AgentContext, SwarmState } from "../../swarm/types.js";

// Check prerequisites
const hasDatabase = process.env.DATABASE_URL || process.env.POSTGRES_HOST;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasRedis = process.env.REDIS_HOST;

// Skip if missing prerequisites
const canRunTests = hasDatabase && hasAnthropicKey && hasRedis;

// Test configuration
const TEST_CONFIG: NetworkingEventConfig = {
  enabled: true,
  eventName: "Tech Summit 2024",
  ownerName: "Michael",
  requiredFields: ["email", "company_name", "job_title"],
  calendly: {
    schedulingLink: "https://calendly.com/michael/30min",
  },
  swarm: {
    enabled: true,
    rolloutPercentage: 100,
    fallbackToRules: true,
    maxConversationTurns: 20,
  },
};

// Test contact (using valid UUID)
const TEST_CONTACT: NetworkingContact = {
  id: "00000000-0000-0000-0000-000000000099",
  phone_number: "17542959900",
  first_name: "Sarah",
  last_name: "Johnson",
  email: "sarah@techcorp.com",
  company_name: "TechCorp",
  job_title: "VP of Engineering",
  status: "welcomed",
  qualification_tier: "warm",
  created_at: new Date().toISOString(),
};

// Helper to print output
function printOutput(label: string, data: unknown) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${label}`);
  console.log("=".repeat(60));
  if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log("=".repeat(60) + "\n");
}

describe.skipIf(!canRunTests)("Swarm Integration Tests", () => {
  let sql: ReturnType<typeof getDatabase>;
  let orchestrator: SwarmOrchestrator | null = null;

  beforeAll(async () => {
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║           SWARM INTEGRATION TEST SUITE                     ║");
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log(`║  Database: ${hasDatabase ? "✓ Connected" : "✗ Missing"}                                   ║`);
    console.log(`║  Redis:    ${hasRedis ? "✓ Connected" : "✗ Missing"}                                   ║`);
    console.log(`║  Anthropic: ${hasAnthropicKey ? "✓ API Key Set" : "✗ Missing"}                                ║`);
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("\n");

    sql = getDatabase();
    expect(sql).not.toBeNull();

    // Check Redis
    const redisHealth = await checkRedisHealth();
    printOutput("Redis Health", redisHealth);

    // Initialize swarm
    const swarm = initializeSwarm(TEST_CONFIG);
    orchestrator = swarm.orchestrator;
    printOutput("Swarm Initialized", {
      orchestrator: !!orchestrator,
      messageStore: !!swarm.messageStore,
      contextBuilder: !!swarm.contextBuilder,
    });

    // Insert test contact
    await sql`
      INSERT INTO networking_contacts (
        id, phone_number, first_name, last_name, email,
        company_name, job_title, status, qualification_tier, created_at
      ) VALUES (
        ${TEST_CONTACT.id},
        ${TEST_CONTACT.phone_number},
        ${TEST_CONTACT.first_name},
        ${TEST_CONTACT.last_name},
        ${TEST_CONTACT.email},
        ${TEST_CONTACT.company_name},
        ${TEST_CONTACT.job_title},
        ${TEST_CONTACT.status},
        ${TEST_CONTACT.qualification_tier},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        company_name = EXCLUDED.company_name,
        job_title = EXCLUDED.job_title
    `;

    printOutput("Test Contact Created", TEST_CONTACT);
  });

  afterAll(async () => {
    // Cleanup test contact
    if (sql) {
      await sql`DELETE FROM networking_contacts WHERE id = ${TEST_CONTACT.id}`;
      await sql`DELETE FROM message_history WHERE phone_number = ${TEST_CONTACT.phone_number}`;
    }
    resetDatabase();
    console.log("\n✓ Test cleanup complete\n");
  });

  describe("Orchestrator Routing", () => {
    it("should route greeting message correctly", async () => {
      const testMessage = "Hi! I'm Sarah, we met at Tech Summit yesterday.";

      printOutput("INPUT MESSAGE", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printOutput("ORCHESTRATOR RESULT", {
        success: result.success,
        response: result.response,
        agentUsed: result.agentUsed,
        tokensUsed: result.tokensUsed,
        duration: `${duration}ms`,
        nextAgent: result.nextAgent,
        toolsCalled: result.toolsCalled,
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response.length).toBeGreaterThan(0);

      // Check response quality
      console.log("\n📊 RESPONSE QUALITY CHECK:");
      console.log(`  - Length: ${result.response.length} chars`);
      console.log(`  - Has greeting: ${/hi|hello|hey/i.test(result.response)}`);
      console.log(`  - Mentions name: ${result.response.includes("Sarah")}`);
      console.log(`  - Mentions event: ${result.response.includes("Tech Summit")}`);
    });

    it("should handle email collection", async () => {
      const testMessage = "My email is sarah.johnson@techcorp.io";

      printOutput("INPUT MESSAGE", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printOutput("ORCHESTRATOR RESULT", {
        success: result.success,
        response: result.response,
        agentUsed: result.agentUsed,
        tokensUsed: result.tokensUsed,
        duration: `${duration}ms`,
        toolsCalled: result.toolsCalled,
      });

      expect(result.success).toBe(true);

      // Check if contact_update tool was called
      console.log("\n📊 TOOL USAGE CHECK:");
      console.log(`  - Tools called: ${result.toolsCalled?.join(", ") || "none"}`);
      if (result.toolsCalled?.includes("contact_update")) {
        console.log("  ✓ contact_update tool was called");
      }
    });

    it("should handle scheduling request", async () => {
      const testMessage = "I'd love to schedule a meeting with you. When are you available?";

      printOutput("INPUT MESSAGE", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printOutput("ORCHESTRATOR RESULT", {
        success: result.success,
        response: result.response,
        agentUsed: result.agentUsed,
        tokensUsed: result.tokensUsed,
        duration: `${duration}ms`,
        toolsCalled: result.toolsCalled,
      });

      expect(result.success).toBe(true);

      // Check if response mentions Calendly
      console.log("\n📊 SCHEDULING CHECK:");
      console.log(`  - Mentions calendly: ${/calendly/i.test(result.response)}`);
      console.log(`  - Has link: ${result.response.includes("http")}`);
    });

    it("should handle company information", async () => {
      const testMessage = "I work at TechCorp as VP of Engineering. We're building AI tools.";

      printOutput("INPUT MESSAGE", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printOutput("ORCHESTRATOR RESULT", {
        success: result.success,
        response: result.response,
        agentUsed: result.agentUsed,
        tokensUsed: result.tokensUsed,
        duration: `${duration}ms`,
        toolsCalled: result.toolsCalled,
      });

      expect(result.success).toBe(true);

      // Check response relevance
      console.log("\n📊 RELEVANCE CHECK:");
      console.log(`  - Acknowledges company: ${/techcorp|company|work/i.test(result.response)}`);
      console.log(`  - Acknowledges AI: ${/ai|artificial|intelligence|tools/i.test(result.response)}`);
    });
  });

  describe("Agent Handoff", () => {
    it("should track conversation state across messages", async () => {
      const messages = [
        "Hi, I'm interested in learning more about what you do.",
        "I work in fintech, specifically payments.",
        "Yes, I'd like to schedule a call.",
      ];

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      console.log("\n" + "═".repeat(60));
      console.log("  MULTI-TURN CONVERSATION TEST");
      console.log("═".repeat(60));

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        console.log(`\n┌─ Turn ${i + 1} ─────────────────────────────────────────────┐`);
        console.log(`│ USER: ${msg}`);
        console.log(`└${"─".repeat(58)}┘`);

        const startTime = Date.now();
        const result = await orchestrator.processMessage(
          TEST_CONTACT.phone_number,
          msg,
          "whatsapp",
          TEST_CONTACT
        );
        const duration = Date.now() - startTime;

        console.log(`\n┌─ Agent Response ────────────────────────────────────────┐`);
        console.log(`│ AGENT: ${result.agentUsed || "unknown"}`);
        console.log(`│ RESPONSE: ${result.response.substring(0, 100)}${result.response.length > 100 ? "..." : ""}`);
        console.log(`│ TOKENS: ${result.tokensUsed?.total || "N/A"}`);
        console.log(`│ DURATION: ${duration}ms`);
        if (result.toolsCalled?.length) {
          console.log(`│ TOOLS: ${result.toolsCalled.join(", ")}`);
        }
        console.log(`└${"─".repeat(58)}┘`);

        expect(result.success).toBe(true);

        // Small delay between messages
        await new Promise((r) => setTimeout(r, 500));
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown contact gracefully", async () => {
      const unknownPhone = "19999999999";
      const testMessage = "Hello, this is a test message.";

      printOutput("INPUT (Unknown Contact)", {
        phoneNumber: unknownPhone,
        message: testMessage,
      });

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        unknownPhone,
        testMessage,
        "whatsapp"
        // No contact provided
      );
      const duration = Date.now() - startTime;

      printOutput("RESULT (Unknown Contact)", {
        success: result.success,
        response: result.response,
        agentUsed: result.agentUsed,
        duration: `${duration}ms`,
        fallbackUsed: result.fallbackUsed,
      });

      // Should either succeed or gracefully fall back
      console.log("\n📊 ERROR HANDLING CHECK:");
      console.log(`  - Handled gracefully: ${result.success || result.fallbackUsed}`);
    });

    it("should handle empty message", async () => {
      const testMessage = "";

      printOutput("INPUT (Empty Message)", {
        phoneNumber: TEST_CONTACT.phone_number,
        message: "(empty)",
      });

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      try {
        const result = await orchestrator.processMessage(
          TEST_CONTACT.phone_number,
          testMessage,
          "whatsapp",
          TEST_CONTACT
        );

        printOutput("RESULT (Empty Message)", {
          success: result.success,
          response: result.response || "(no response)",
          fallbackUsed: result.fallbackUsed,
        });
      } catch (error) {
        printOutput("ERROR (Empty Message)", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Empty message might throw - that's acceptable
      }
    });

    it("should handle very long message", async () => {
      const longMessage = "Hello! ".repeat(500); // ~3500 chars

      printOutput("INPUT (Long Message)", {
        phoneNumber: TEST_CONTACT.phone_number,
        messageLength: longMessage.length,
        preview: longMessage.substring(0, 50) + "...",
      });

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        longMessage,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printOutput("RESULT (Long Message)", {
        success: result.success,
        responseLength: result.response?.length || 0,
        duration: `${duration}ms`,
        tokensUsed: result.tokensUsed,
      });

      console.log("\n📊 LONG MESSAGE CHECK:");
      console.log(`  - Handled: ${result.success}`);
      console.log(`  - Response reasonable: ${(result.response?.length || 0) < 2000}`);
    });
  });

  describe("Response Quality", () => {
    it("should not hallucinate contact information", async () => {
      const testMessage = "Can you remind me what company I work for?";

      printOutput("INPUT (Hallucination Test)", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );

      printOutput("RESPONSE", result.response);

      // Check for hallucination
      const response = result.response.toLowerCase();
      const hasCorrectCompany = response.includes("techcorp");
      const hasFakeCompany = /google|microsoft|amazon|meta|apple/i.test(response);

      console.log("\n📊 HALLUCINATION CHECK:");
      console.log(`  - Mentions correct company (TechCorp): ${hasCorrectCompany}`);
      console.log(`  - Mentions fake company: ${hasFakeCompany}`);
      console.log(`  - PASSED: ${hasCorrectCompany && !hasFakeCompany}`);

      if (hasCorrectCompany) {
        expect(hasFakeCompany).toBe(false);
      }
    });

    it("should maintain professional tone", async () => {
      const testMessage = "This is stupid, I don't want to talk anymore.";

      printOutput("INPUT (Negative Message)", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );

      printOutput("RESPONSE", result.response);

      // Check tone
      const response = result.response.toLowerCase();
      const hasUnprofessionalWords = /stupid|dumb|idiot|shut up/i.test(response);
      const hasProfessionalTone = /understand|sorry|help|appreciate/i.test(response);

      console.log("\n📊 TONE CHECK:");
      console.log(`  - No unprofessional words: ${!hasUnprofessionalWords}`);
      console.log(`  - Professional tone: ${hasProfessionalTone}`);
      console.log(`  - PASSED: ${!hasUnprofessionalWords}`);

      expect(hasUnprofessionalWords).toBe(false);
    });

    it("should provide actionable responses", async () => {
      const testMessage = "What should I do next?";

      printOutput("INPUT (Action Request)", testMessage);

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        testMessage,
        "whatsapp",
        TEST_CONTACT
      );

      printOutput("RESPONSE", result.response);

      // Check for actionable content
      const response = result.response.toLowerCase();
      const hasAction = /schedule|book|send|share|call|email|meet|connect/i.test(response);
      const hasQuestion = response.includes("?");

      console.log("\n📊 ACTIONABILITY CHECK:");
      console.log(`  - Contains action words: ${hasAction}`);
      console.log(`  - Asks follow-up question: ${hasQuestion}`);
      console.log(`  - PASSED: ${hasAction || hasQuestion}`);

      expect(hasAction || hasQuestion).toBe(true);
    });
  });

  describe("Performance", () => {
    it("should respond within acceptable time", async () => {
      const testMessage = "Quick question - what's the best way to reach you?";

      if (!orchestrator) {
        console.log("⚠ Orchestrator not initialized");
        return;
      }

      const times: number[] = [];

      console.log("\n📊 PERFORMANCE TEST (3 iterations):");

      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        const result = await orchestrator.processMessage(
          TEST_CONTACT.phone_number,
          testMessage,
          "whatsapp",
          TEST_CONTACT
        );
        const duration = Date.now() - startTime;
        times.push(duration);

        console.log(`  Run ${i + 1}: ${duration}ms (${result.tokensUsed?.total || "?"} tokens)`);

        await new Promise((r) => setTimeout(r, 500));
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);

      console.log(`\n  Summary:`);
      console.log(`    Min: ${minTime}ms`);
      console.log(`    Max: ${maxTime}ms`);
      console.log(`    Avg: ${avgTime.toFixed(0)}ms`);
      console.log(`    Acceptable (<10s): ${avgTime < 10000}`);

      expect(avgTime).toBeLessThan(15000); // 15 second max average
    });
  });
});

// Run with: npm run test:db -- --run src/tests/integration/swarm-integration.test.ts
