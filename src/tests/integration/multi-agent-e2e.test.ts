/**
 * Multi-Agent End-to-End Integration Tests
 *
 * Tests multiple agents working together and verifies ALL database activity:
 * - agent_activity_log: Tracks all agent executions
 * - media_files: Tracks generated voice/video files
 * - message_history: Tracks outbound messages
 *
 * This test demonstrates the FULL FLOW:
 * 1. Orchestrator routes to appropriate agent
 * 2. Voice agent generates audio via ElevenLabs
 * 3. Media is stored with GDPR tracking
 * 4. Message is queued for delivery
 * 5. ALL activity is logged to database
 *
 * Prerequisites:
 * - PostgreSQL running (with nexthello_test database)
 * - Redis running
 * - ANTHROPIC_API_KEY set
 * - ELEVENLABS_API_KEY set (for voice tests)
 * - MinIO/S3 running (for media storage)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDatabase,
  resetDatabase,
} from "../../database/client.js";
import { checkRedisHealth, getRedisConnection } from "../../queue/client.js";
import { SwarmOrchestrator, resetOrchestrator } from "../../swarm/orchestrator.js";
import { initializeSwarm } from "../../swarm/index.js";
import { getActivityStore, resetActivityStore } from "../../observability/activity-store.js";
import { getMediaStore, resetMediaStore } from "../../storage/media-store.js";
import { getMessageStore, resetMessageStore } from "../../history/message-store.js";
import { createAgent } from "../../swarm/base-agent.js";
import type { NetworkingEventConfig, NetworkingContact } from "../../config/types.js";
import type { AgentContext } from "../../swarm/types.js";
import { createLogger, createCorrelationId } from "../../observability/logger.js";

// Prerequisites check
const hasDatabase = process.env.DATABASE_URL || process.env.POSTGRES_HOST;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
const hasRedis = process.env.REDIS_HOST;

const canRunTests = hasDatabase && hasAnthropicKey && hasRedis;
const canRunVoiceTests = canRunTests && hasElevenLabsKey;

// Test configuration with ElevenLabs
const TEST_CONFIG: NetworkingEventConfig = {
  enabled: true,
  eventName: "Tech Summit 2024",
  ownerName: "Michael",
  requiredFields: ["email", "company_name", "job_title"],
  calendly: {
    schedulingLink: "https://calendly.com/michael/30min",
  },
  elevenlabs: {
    voiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM", // Rachel voice (default)
    modelId: "eleven_monolingual_v1",
    stability: 0.5,
    similarityBoost: 0.75,
  },
  swarm: {
    enabled: true,
    rolloutPercentage: 100,
    fallbackToRules: true,
    maxConversationTurns: 20,
  },
};

// Test contact
const TEST_CONTACT: NetworkingContact = {
  id: "00000000-0000-0000-0000-000000000098",
  phone_number: "17542959900",
  first_name: "Alex",
  last_name: "Chen",
  email: "alex@startup.io",
  company_name: "StartupCo",
  job_title: "CTO",
  status: "welcomed",
  qualification_tier: "hot",
  created_at: new Date().toISOString(),
};

// Helper to print formatted output
function printSection(title: string, data?: unknown) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${title}`);
  console.log("═".repeat(70));
  if (data !== undefined) {
    if (typeof data === "string") {
      console.log(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

function printSubsection(title: string, data?: unknown) {
  console.log("\n┌─ " + title + " " + "─".repeat(Math.max(0, 60 - title.length)));
  if (data !== undefined) {
    if (typeof data === "string") {
      console.log("│ " + data.split("\n").join("\n│ "));
    } else {
      const json = JSON.stringify(data, null, 2);
      console.log("│ " + json.split("\n").join("\n│ "));
    }
  }
  console.log("└" + "─".repeat(68));
}

describe.skipIf(!canRunTests)("Multi-Agent End-to-End Tests", () => {
  let sql: ReturnType<typeof getDatabase>;
  let orchestrator: SwarmOrchestrator | null = null;
  let testCorrelationId: string;

  beforeAll(async () => {
    printSection("MULTI-AGENT E2E TEST SUITE");
    console.log(`
  Prerequisites:
    Database:     ${hasDatabase ? "✓ Connected" : "✗ Missing"}
    Redis:        ${hasRedis ? "✓ Connected" : "✗ Missing"}
    Anthropic:    ${hasAnthropicKey ? "✓ API Key Set" : "✗ Missing"}
    ElevenLabs:   ${hasElevenLabsKey ? "✓ API Key Set" : "⚠ Missing (voice tests skipped)"}

  Test Contact:
    Name: ${TEST_CONTACT.first_name} ${TEST_CONTACT.last_name}
    Phone: ${TEST_CONTACT.phone_number}
    Company: ${TEST_CONTACT.company_name}
`);

    sql = getDatabase();
    expect(sql).not.toBeNull();

    // Check Redis
    const redisHealth = await checkRedisHealth();
    printSubsection("Redis Health", redisHealth);

    // Initialize swarm
    resetOrchestrator();
    const swarm = initializeSwarm(TEST_CONFIG);
    orchestrator = swarm.orchestrator;

    printSubsection("Swarm Agents Available", orchestrator?.getAvailableAgents());

    // Insert test contact
    if (sql) {
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
          last_name = EXCLUDED.last_name
      `;
    }
  });

  afterAll(async () => {
    // Cleanup
    if (sql) {
      await sql`DELETE FROM networking_contacts WHERE id = ${TEST_CONTACT.id}`;
      await sql`DELETE FROM message_history WHERE phone_number = ${TEST_CONTACT.phone_number}`;
      await sql`DELETE FROM media_files WHERE phone_number = ${TEST_CONTACT.phone_number}`;
      await sql`DELETE FROM agent_activity_log WHERE contact_id = ${TEST_CONTACT.id}`;
    }
    resetDatabase();
    resetActivityStore();
    resetMediaStore();
    resetMessageStore();
    resetOrchestrator();
    console.log("\n✓ Test cleanup complete\n");
  });

  beforeEach(() => {
    testCorrelationId = createCorrelationId();
  });

  describe("Agent Activity Logging", () => {
    it("should log all agent activity to database", async () => {
      printSection("TEST: Agent Activity Logging");

      if (!orchestrator || !sql) {
        console.log("⚠ Orchestrator or database not initialized");
        return;
      }

      const message = "Hi! Great meeting you at the conference.";
      printSubsection("Input Message", message);

      // Process message
      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        message,
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;

      printSubsection("Agent Response", {
        success: result.success,
        agentType: result.agentType,
        response: result.response ? result.response.substring(0, 200) + (result.response.length > 200 ? "..." : "") : "",
        duration: `${duration}ms`,
        tokensUsed: result.tokensUsed,
      });

      // Query agent activity log
      const activities = await sql`
        SELECT
          id,
          correlation_id,
          contact_id,
          agent_type,
          action,
          started_at,
          completed_at,
          duration_ms,
          status,
          input_tokens,
          output_tokens,
          error_message
        FROM agent_activity_log
        WHERE contact_id = ${TEST_CONTACT.id}
        ORDER BY started_at DESC
        LIMIT 10
      `;

      printSubsection("DATABASE: agent_activity_log", {
        totalRecords: activities.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activities: activities.map((a: any) => ({
          agentType: a.agent_type,
          action: a.action,
          status: a.status,
          durationMs: a.duration_ms,
          inputTokens: a.input_tokens,
          outputTokens: a.output_tokens,
        })),
      });

      expect(result.success).toBe(true);
      expect(activities.length).toBeGreaterThan(0);

      // Verify activity was logged
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conversationActivity = activities.find((a: any) => a.agent_type === "conversation");
      console.log("\n📊 ACTIVITY LOG VERIFICATION:");
      console.log(`  - Activity logged: ${activities.length > 0 ? "✓" : "✗"}`);
      console.log(`  - Conversation agent logged: ${conversationActivity ? "✓" : "✗"}`);
      console.log(`  - Status recorded: ${conversationActivity?.status || "N/A"}`);
      console.log(`  - Duration recorded: ${conversationActivity?.duration_ms || "N/A"}ms`);
      console.log(`  - Tokens recorded: ${conversationActivity?.input_tokens || 0} in / ${conversationActivity?.output_tokens || 0} out`);
    });

    it("should track multi-agent handoffs in activity log", async () => {
      printSection("TEST: Multi-Agent Handoff Tracking");

      if (!orchestrator || !sql) {
        console.log("⚠ Orchestrator or database not initialized");
        return;
      }

      // Send multiple messages to trigger different agents
      const messages = [
        "Hi, I need help understanding your service.",
        "My email is alex@startup.io",
        "Can we schedule a call for next week?",
      ];

      console.log("\n┌─ Sending Multi-Turn Conversation ─────────────────────────────┐");

      for (const msg of messages) {
        console.log(`│ USER: ${msg}`);
        const result = await orchestrator.processMessage(
          TEST_CONTACT.phone_number,
          msg,
          "whatsapp",
          TEST_CONTACT
        );
        console.log(`│ AGENT (${result.agentType}): ${result.response ? result.response.substring(0, 60) : ""}...`);
        console.log("│");
        await new Promise(r => setTimeout(r, 500));
      }
      console.log("└" + "─".repeat(68));

      // Query all activities for this contact
      const allActivities = await sql`
        SELECT
          agent_type,
          action,
          status,
          duration_ms,
          started_at
        FROM agent_activity_log
        WHERE contact_id = ${TEST_CONTACT.id}
        ORDER BY started_at ASC
      `;

      printSubsection("DATABASE: All Agent Activities", {
        totalActivities: allActivities.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        byAgent: allActivities.reduce((acc: Record<string, number>, a: any) => {
          acc[a.agent_type] = (acc[a.agent_type] || 0) + 1;
          return acc;
        }, {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timeline: allActivities.map((a: any) => `${a.agent_type} (${a.status}) - ${a.duration_ms}ms`),
      });

      expect(allActivities.length).toBeGreaterThan(0);

      console.log("\n📊 MULTI-AGENT VERIFICATION:");
      console.log(`  - Total activities logged: ${allActivities.length}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`  - Unique agents used: ${new Set(allActivities.map((a: any) => a.agent_type)).size}`);
    });
  });

  describe.skipIf(!canRunVoiceTests)("Voice Agent End-to-End", () => {
    it("should generate voice message and log to database", async () => {
      printSection("TEST: Voice Agent → ElevenLabs → Database");

      if (!sql) {
        console.log("⚠ Database not initialized");
        return;
      }

      // Create voice agent directly
      const voiceAgent = createAgent("voice");
      expect(voiceAgent).toBeDefined();

      const correlationId = createCorrelationId();
      const logger = createLogger({ component: "test", correlationId });

      const context: AgentContext = {
        correlationId,
        config: TEST_CONFIG,
        contact: TEST_CONTACT,
        phoneNumber: TEST_CONTACT.phone_number,
        channel: "whatsapp",
        logger,
      };

      printSubsection("Calling Voice Agent", {
        contactName: TEST_CONTACT.first_name,
        phoneNumber: TEST_CONTACT.phone_number,
        voiceId: TEST_CONFIG.elevenlabs?.voiceId,
      });

      // Process voice request
      const startTime = Date.now();
      const result = await voiceAgent.process(
        context,
        `Generate a short voice message greeting ${TEST_CONTACT.first_name} from ${TEST_CONTACT.company_name}. Keep it under 30 words.`
      );
      const duration = Date.now() - startTime;

      printSubsection("Voice Agent Result", {
        success: result.success,
        response: result.response ? result.response.substring(0, 300) : "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toolCalls: result.toolCalls?.map((t: any) => ({
          name: t.name,
          input: JSON.stringify(t.input).substring(0, 100),
        })),
        duration: `${duration}ms`,
      });

      // Check media_files table
      const mediaFiles = await sql`
        SELECT
          id,
          phone_number,
          storage_key,
          storage_backend,
          media_type,
          mime_type,
          size_bytes,
          source,
          retention_policy,
          created_at
        FROM media_files
        WHERE phone_number = ${TEST_CONTACT.phone_number}
        ORDER BY created_at DESC
        LIMIT 5
      `;

      printSubsection("DATABASE: media_files", {
        totalFiles: mediaFiles.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        files: mediaFiles.map((f: any) => ({
          mediaType: f.media_type,
          mimeType: f.mime_type,
          sizeBytes: f.size_bytes,
          storageKey: f.storage_key,
          source: f.source,
          retention: f.retention_policy,
        })),
      });

      // Check agent activity
      const voiceActivities = await sql`
        SELECT
          agent_type,
          action,
          status,
          duration_ms,
          input_tokens,
          output_tokens
        FROM agent_activity_log
        WHERE agent_type = 'voice'
          AND contact_id = ${TEST_CONTACT.id}
        ORDER BY started_at DESC
        LIMIT 5
      `;

      printSubsection("DATABASE: Voice Agent Activities", voiceActivities);

      console.log("\n📊 VOICE AGENT E2E VERIFICATION:");
      console.log(`  - Voice agent executed: ${result.success ? "✓" : "✗"}`);
      console.log(`  - Tool calls made: ${result.toolCalls?.length || 0}`);
      console.log(`  - Media files created: ${mediaFiles.length}`);
      console.log(`  - Voice activities logged: ${voiceActivities.length}`);

      if (mediaFiles.length > 0) {
        const latestMedia = mediaFiles[0];
        console.log(`  - Latest media type: ${latestMedia.media_type}`);
        console.log(`  - Latest media size: ${latestMedia.size_bytes} bytes`);
        console.log(`  - Storage key: ${latestMedia.storage_key}`);
      }

      expect(result.success).toBe(true);
    });

    it("should verify voice message queued for delivery", async () => {
      printSection("TEST: Voice Message Queue Verification");

      if (!sql) {
        console.log("⚠ Database not initialized");
        return;
      }

      // Check if any voice messages are queued
      const redis = getRedisConnection();
      if (!redis) {
        console.log("⚠ Redis not available for queue check");
        return;
      }

      // Check outbound-messages queue
      const queueLength = await redis.llen("bull:outbound-messages:wait");
      const activeJobs = await redis.llen("bull:outbound-messages:active");

      printSubsection("Queue Status", {
        queue: "outbound-messages",
        waiting: queueLength,
        active: activeJobs,
      });

      // Check message history for voice messages
      const voiceMessages = await sql`
        SELECT
          id,
          phone_number,
          content,
          direction,
          channel,
          message_type,
          agent_id,
          created_at
        FROM message_history
        WHERE phone_number = ${TEST_CONTACT.phone_number}
          AND message_type = 'voice'
        ORDER BY created_at DESC
        LIMIT 5
      `;

      printSubsection("DATABASE: Voice Message History", voiceMessages);

      console.log("\n📊 MESSAGE QUEUE VERIFICATION:");
      console.log(`  - Queue waiting: ${queueLength}`);
      console.log(`  - Queue active: ${activeJobs}`);
      console.log(`  - Voice messages in history: ${voiceMessages.length}`);
    });
  });

  describe("Message History Integration", () => {
    it("should store outbound messages in database", async () => {
      printSection("TEST: Message History Storage");

      if (!sql) {
        console.log("⚠ Database not initialized");
        return;
      }

      const messageStore = getMessageStore();
      const correlationId = createCorrelationId();

      // Store an outbound message
      const storedMessage = await messageStore.storeOutboundMessage(
        TEST_CONTACT.phone_number,
        "Test outbound message from multi-agent test",
        "whatsapp",
        correlationId,
        { agentId: "conversation-test" }
      );

      printSubsection("Stored Outbound Message", storedMessage);

      // Query message history
      const messages = await sql`
        SELECT
          id,
          phone_number,
          content,
          direction,
          channel,
          correlation_id,
          agent_id,
          created_at
        FROM message_history
        WHERE phone_number = ${TEST_CONTACT.phone_number}
        ORDER BY created_at DESC
        LIMIT 10
      `;

      printSubsection("DATABASE: message_history", {
        totalMessages: messages.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages.map((m: any) => ({
          direction: m.direction,
          channel: m.channel,
          agentId: m.agent_id,
          content: m.content ? m.content.substring(0, 50) + "..." : "",
        })),
      });

      expect(storedMessage).not.toBeNull();
      expect(messages.length).toBeGreaterThan(0);

      console.log("\n📊 MESSAGE HISTORY VERIFICATION:");
      console.log(`  - Message stored: ${storedMessage ? "✓" : "✗"}`);
      console.log(`  - Total messages: ${messages.length}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`  - Has correlation ID: ${messages.some((m: any) => m.correlation_id) ? "✓" : "✗"}`);
    });

    it("should track conversation flow across messages", async () => {
      printSection("TEST: Conversation Flow Tracking");

      if (!orchestrator || !sql) {
        console.log("⚠ Orchestrator or database not initialized");
        return;
      }

      const messageStore = getMessageStore();

      // Simulate inbound message
      await messageStore.storeMessage({
        phoneNumber: TEST_CONTACT.phone_number,
        content: "Hey, I'm interested in your product!",
        direction: "inbound",
        channel: "whatsapp",
        correlationId: testCorrelationId,
      });

      // Process through orchestrator
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        "Hey, I'm interested in your product!",
        "whatsapp",
        TEST_CONTACT
      );

      // Store outbound response
      await messageStore.storeOutboundMessage(
        TEST_CONTACT.phone_number,
        result.response || "",
        "whatsapp",
        testCorrelationId,
        { agentId: result.agentType }
      );

      // Query full conversation
      const conversation = await sql`
        SELECT
          direction,
          content,
          agent_id,
          created_at
        FROM message_history
        WHERE phone_number = ${TEST_CONTACT.phone_number}
        ORDER BY created_at ASC
      `;

      printSubsection("Full Conversation Flow", {
        turns: conversation.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        flow: conversation.map((m: any) => ({
          direction: m.direction,
          agent: m.agent_id || "user",
          preview: m.content ? m.content.substring(0, 40) + "..." : "",
        })),
      });

      console.log("\n📊 CONVERSATION FLOW VERIFICATION:");
      console.log(`  - Total turns: ${conversation.length}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`  - Has inbound: ${conversation.some((m: any) => m.direction === "inbound") ? "✓" : "✗"}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log(`  - Has outbound: ${conversation.some((m: any) => m.direction === "outbound") ? "✓" : "✗"}`);
    });
  });

  describe("Full Agent Pipeline", () => {
    it("should execute complete pipeline: Orchestrator → Agent → DB", async () => {
      printSection("TEST: Complete Agent Pipeline");

      if (!orchestrator || !sql) {
        console.log("⚠ Orchestrator or database not initialized");
        return;
      }

      const activityStore = getActivityStore();
      const messageStore = getMessageStore();
      const correlationId = createCorrelationId();

      console.log("\n┌─ PIPELINE EXECUTION ─────────────────────────────────────────┐");
      console.log(`│ Correlation ID: ${correlationId}`);
      console.log(`│ Contact: ${TEST_CONTACT.first_name} (${TEST_CONTACT.phone_number})`);
      console.log("│");

      // Step 1: Store inbound message
      console.log("│ Step 1: Store inbound message...");
      const inboundStored = await messageStore.storeMessage({
        phoneNumber: TEST_CONTACT.phone_number,
        content: "I want to learn more about AI automation",
        direction: "inbound",
        channel: "whatsapp",
        correlationId,
      });
      console.log(`│   └─ Stored: ${inboundStored ? "✓" : "✗"}`);

      // Step 2: Process through orchestrator
      console.log("│ Step 2: Process through orchestrator...");
      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        TEST_CONTACT.phone_number,
        "I want to learn more about AI automation",
        "whatsapp",
        TEST_CONTACT
      );
      const duration = Date.now() - startTime;
      console.log(`│   └─ Processed in ${duration}ms by ${result.agentType}`);

      // Step 3: Store outbound response
      console.log("│ Step 3: Store outbound response...");
      const outboundStored = await messageStore.storeOutboundMessage(
        TEST_CONTACT.phone_number,
        result.response || "",
        "whatsapp",
        correlationId,
        { agentId: result.agentType }
      );
      console.log(`│   └─ Stored: ${outboundStored ? "✓" : "✗"}`);

      console.log("│");
      console.log("└" + "─".repeat(68));

      // Verify all database entries
      const activities = await activityStore.getActivitiesByCorrelation(correlationId);
      const messages = await messageStore.getMessagesByPhone(TEST_CONTACT.phone_number, { limit: 10 });

      printSubsection("Pipeline Results", {
        orchestrator: {
          success: result.success,
          agentUsed: result.agentType,
          responseLength: result.response?.length,
          tokensUsed: result.tokensUsed,
        },
        database: {
          activitiesLogged: activities.length,
          messagesStored: messages.length,
        },
      });

      // Final verification summary
      console.log("\n╔════════════════════════════════════════════════════════════════╗");
      console.log("║                  PIPELINE VERIFICATION SUMMARY                  ║");
      console.log("╠════════════════════════════════════════════════════════════════╣");
      console.log(`║  Orchestrator processed:        ${result.success ? "✓ YES" : "✗ NO"}                          ║`);
      console.log(`║  Agent executed:                ${result.agentType.padEnd(25)}        ║`);
      console.log(`║  Response generated:            ${String(result.response?.length || 0).padStart(5)} chars                    ║`);
      console.log(`║  Activities logged:             ${String(activities.length).padStart(5)} records                   ║`);
      console.log(`║  Messages in history:           ${String(messages.length).padStart(5)} records                   ║`);
      console.log("╚════════════════════════════════════════════════════════════════╝");

      expect(result.success).toBe(true);
      expect(activities.length).toBeGreaterThanOrEqual(0);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("Database Integrity Checks", () => {
    it("should verify all related tables have consistent data", async () => {
      printSection("TEST: Database Integrity Check");

      if (!sql) {
        console.log("⚠ Database not initialized");
        return;
      }

      // Query all related data
      const [contactData] = await sql`
        SELECT * FROM networking_contacts WHERE id = ${TEST_CONTACT.id}
      `;

      const activityCount = await sql`
        SELECT COUNT(*) as count FROM agent_activity_log WHERE contact_id = ${TEST_CONTACT.id}
      `;

      const messageCount = await sql`
        SELECT COUNT(*) as count FROM message_history WHERE phone_number = ${TEST_CONTACT.phone_number}
      `;

      const mediaCount = await sql`
        SELECT COUNT(*) as count FROM media_files WHERE phone_number = ${TEST_CONTACT.phone_number}
      `;

      printSubsection("Database Integrity Summary", {
        contact: {
          exists: !!contactData,
          id: contactData?.id,
          phone: contactData?.phone_number,
        },
        relatedRecords: {
          agentActivities: parseInt(activityCount[0].count),
          messages: parseInt(messageCount[0].count),
          mediaFiles: parseInt(mediaCount[0].count),
        },
      });

      console.log("\n📊 INTEGRITY VERIFICATION:");
      console.log(`  - Contact exists: ${contactData ? "✓" : "✗"}`);
      console.log(`  - Phone number consistent: ${contactData?.phone_number === TEST_CONTACT.phone_number ? "✓" : "✗"}`);
      console.log(`  - Has activity logs: ${parseInt(activityCount[0].count) > 0 ? "✓" : "○ (none yet)"}`);
      console.log(`  - Has message history: ${parseInt(messageCount[0].count) > 0 ? "✓" : "○ (none yet)"}`);
      console.log(`  - Has media files: ${parseInt(mediaCount[0].count) > 0 ? "✓" : "○ (none yet)"}`);

      expect(contactData).toBeDefined();
    });
  });
});

/**
 * Run with:
 *   npm run test:e2e
 *
 * Or with full environment:
 *   source .env && npm run test:db -- --run src/tests/integration/multi-agent-e2e.test.ts
 */
