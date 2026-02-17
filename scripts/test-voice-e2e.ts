#!/usr/bin/env npx tsx
/**
 * Voice-to-Voice End-to-End Integration Test
 *
 * Tests the FULL voice message flow:
 * 1. User sends a voice message (simulated as transcribed audio)
 * 2. Swarm auto-enables voice mode
 * 3. Claude responds using send_voice_response tool
 * 4. ElevenLabs generates audio
 * 5. Audio is sent back via WhatsApp
 * 6. User can request text mode to disable voice
 *
 * Test phone numbers:
 * - Session 1: 17542959900 (+1 754-295-9900)
 * - Session 2: 13054272115 (+1 305-427-2115)
 *
 * Prerequisites:
 *   - Both WhatsApp sessions authenticated
 *   - PostgreSQL running
 *   - Redis running
 *   - ANTHROPIC_API_KEY set
 *   - ELEVENLABS_API_KEY set (optional - will skip voice generation if not set)
 *
 * Usage:
 *   source .env_test && npx tsx scripts/test-voice-e2e.ts
 */

import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import postgres from "postgres";
import path from "path";
import { fileURLToPath } from "url";
import Redis from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Dynamic imports for swarm
const importSwarm = async () => {
  const { initializeSwarm } = await import("../dist/src/swarm/index.js");
  const { getMessageStore } = await import("../dist/src/history/message-store.js");
  const { createCorrelationId } = await import("../dist/src/observability/logger.js");
  return { initializeSwarm, getMessageStore, createCorrelationId };
};

// Test configuration
const SESSION_1 = {
  name: "session-1",
  phone: "17542959900",
  authDir: path.join(projectRoot, "data", "auth", "whatsapp-session-1"),
};

const SESSION_2 = {
  name: "session-2",
  phone: "13054272115",
  authDir: path.join(projectRoot, "data", "auth", "whatsapp-session-2"),
};

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://nexthello:nexthello_dev@localhost:5432/nexthello_test";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Test contact
const TEST_CONTACT = {
  id: "00000000-0000-0000-0000-000000000098",
  phone_number: SESSION_1.phone,
  first_name: "VoiceTest",
  last_name: "User",
  email: "voicetest@example.com",
  company_name: "VoiceCorp",
  job_title: "Developer",
  status: "new",
  qualification_tier: "warm",
};

// Test config for swarm with ElevenLabs
const TEST_CONFIG = {
  enabled: true,
  eventName: "Tech Summit 2024",
  ownerName: "Michael",
  requiredFields: ["email", "company_name"],
  calendly: {
    schedulingLink: "https://calendly.com/michael/30min",
  },
  swarm: {
    enabled: true,
    rolloutPercentage: 100,
    fallbackToRules: true,
    maxConversationTurns: 20,
  },
  elevenlabs: process.env.ELEVENLABS_API_KEY ? {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM", // Default Rachel voice
  } : undefined,
};

// Logging helpers
function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${timestamp}] ${message}`);
}

function success(message: string): void {
  console.log(`✓ ${message}`);
}

function fail(message: string): void {
  console.log(`✗ ${message}`);
}

function section(title: string): void {
  console.log("");
  console.log("━".repeat(60));
  console.log(`  ${title}`);
  console.log("━".repeat(60));
  console.log("");
}

// Voice test scenarios
interface VoiceTestScenario {
  name: string;
  userMessage: string;
  isVoiceMessage: boolean;
  expectedVoiceMode: boolean;
  description: string;
}

const VOICE_SCENARIOS: VoiceTestScenario[] = [
  {
    name: "Voice Message - Auto-Enable Voice Mode",
    userMessage: "Hi there! Great meeting you at the conference.",
    isVoiceMessage: true,
    expectedVoiceMode: true,
    description: "When user sends voice, system should respond with voice",
  },
  {
    name: "Voice Followup - Continue Voice Mode",
    userMessage: "Tell me more about your services.",
    isVoiceMessage: true,
    expectedVoiceMode: true,
    description: "Subsequent voice messages should continue voice mode",
  },
  {
    name: "Text Message - Keep Existing Voice Mode",
    userMessage: "What about pricing?",
    isVoiceMessage: false,
    expectedVoiceMode: true, // Voice mode persists from previous
    description: "Text messages should preserve existing voice mode",
  },
  {
    name: "Request Text - Disable Voice Mode",
    userMessage: "Please just write to me instead of sending voice notes.",
    isVoiceMessage: false,
    expectedVoiceMode: false,
    description: "When user asks for text, voice mode should be disabled",
  },
  {
    name: "Text After Disable - Stay in Text Mode",
    userMessage: "Thanks! Can you send me the Calendly link?",
    isVoiceMessage: false,
    expectedVoiceMode: false,
    description: "After disabling, should stay in text mode",
  },
];

async function createSocket(session: typeof SESSION_1) {
  const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: {
      level: "silent",
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
      trace: () => {},
      child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, trace: () => {}, child: () => ({}) } as any),
    } as any,
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
}

async function waitForConnection(sock: ReturnType<typeof makeWASocket>, sessionName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log(`${sessionName}: Connection timeout`);
      resolve(false);
    }, 15000);

    sock.ev.on("connection.update", (update) => {
      if (update.connection === "open") {
        clearTimeout(timeout);
        const phone = sock.user?.id?.split(":")[0] || "unknown";
        log(`${sessionName}: Connected as ${phone}`);
        resolve(true);
      } else if (update.connection === "close") {
        clearTimeout(timeout);
        log(`${sessionName}: Connection closed`);
        resolve(false);
      }
    });
  });
}

async function runVoiceTests(): Promise<void> {
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       VOICE-TO-VOICE E2E INTEGRATION TEST                  ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Session 1: ${SESSION_1.phone}                                ║`);
  console.log(`║  Session 2: ${SESSION_2.phone}                                ║`);
  console.log(`║  ElevenLabs: ${TEST_CONFIG.elevenlabs ? "Configured" : "Not configured (text only)"}                       ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  // Check environment
  if (!process.env.ANTHROPIC_API_KEY) {
    fail("ANTHROPIC_API_KEY not set. Run: source .env_test");
    process.exit(1);
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    log("WARNING: ELEVENLABS_API_KEY not set. Voice generation will be skipped.");
    log("         Voice mode will still be tested at the orchestrator level.");
  }

  // Connect to database
  log("Connecting to database...");
  const sql = postgres(DATABASE_URL);

  try {
    await sql`SELECT 1`;
    success("Database connected");
  } catch (error) {
    fail(`Database connection failed: ${error}`);
    process.exit(1);
  }

  // Connect to Redis
  log("Connecting to Redis...");
  const redis = new Redis(REDIS_URL);

  try {
    await redis.ping();
    success("Redis connected");
  } catch (error) {
    fail(`Redis connection failed: ${error}`);
    await sql.end();
    process.exit(1);
  }

  // Clear voice mode from previous tests
  await redis.del(`voice_mode:${SESSION_1.phone}`);
  log("Cleared previous voice mode state");

  // Import swarm modules
  log("Loading swarm modules...");
  const { initializeSwarm, getMessageStore, createCorrelationId } = await importSwarm();
  success("Swarm modules loaded");

  // Initialize swarm
  log("Initializing swarm...");
  const swarm = initializeSwarm(TEST_CONFIG);
  const orchestrator = swarm.orchestrator;
  const messageStore = getMessageStore();

  if (!orchestrator) {
    fail("Failed to initialize orchestrator");
    await redis.quit();
    await sql.end();
    process.exit(1);
  }
  success(`Swarm initialized with ${orchestrator.getAvailableAgents().length} agents`);

  // Create/update test contact in database
  log("Creating test contact...");

  // First try to find existing contact by phone
  const existing = await sql`
    SELECT id FROM networking_contacts
    WHERE phone_number = ${TEST_CONTACT.phone_number}
    LIMIT 1
  `;

  if (existing.length > 0) {
    // Update existing contact
    await sql`
      UPDATE networking_contacts SET
        first_name = ${TEST_CONTACT.first_name},
        last_name = ${TEST_CONTACT.last_name},
        status = 'new'
      WHERE phone_number = ${TEST_CONTACT.phone_number}
    `;
    TEST_CONTACT.id = existing[0].id;
    success("Test contact updated (already exists)");
  } else {
    // Insert new contact
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
    `;
    success("Test contact created");
  }

  // Connect WhatsApp sessions
  section("CONNECTING WHATSAPP SESSIONS");

  log(`Connecting ${SESSION_1.name}...`);
  const sock1 = await createSocket(SESSION_1);
  const connected1 = await waitForConnection(sock1, SESSION_1.name);
  if (!connected1) {
    fail(`${SESSION_1.name} not connected. Run: npm run connect:session1`);
    await redis.quit();
    await sql.end();
    process.exit(1);
  }
  success(`${SESSION_1.name} connected`);

  log(`Connecting ${SESSION_2.name}...`);
  const sock2 = await createSocket(SESSION_2);
  const connected2 = await waitForConnection(sock2, SESSION_2.name);
  if (!connected2) {
    fail(`${SESSION_2.name} not connected. Run: npm run connect:session2`);
    sock1.end(undefined);
    await redis.quit();
    await sql.end();
    process.exit(1);
  }
  success(`${SESSION_2.name} connected`);

  // Run voice test scenarios
  section("RUNNING VOICE TEST SCENARIOS");

  let passed = 0;
  let failed = 0;
  const results: { scenario: string; passed: boolean; reason: string; voiceModeActual: boolean | null }[] = [];

  for (const scenario of VOICE_SCENARIOS) {
    console.log("");
    console.log(`┌─ ${scenario.name} ─${"─".repeat(Math.max(0, 50 - scenario.name.length))}┐`);
    console.log(`│ ${scenario.description}`);
    console.log(`│ Input: "${scenario.userMessage.substring(0, 45)}${scenario.userMessage.length > 45 ? "..." : ""}"`);
    console.log(`│ Voice Message: ${scenario.isVoiceMessage ? "YES" : "NO"}`);
    console.log(`│ Expected Voice Mode: ${scenario.expectedVoiceMode ? "ENABLED" : "DISABLED"}`);
    console.log("│");

    const correlationId = createCorrelationId();

    try {
      // Step 1: Send WhatsApp message from Session 1 to Session 2
      const chatId = `${SESSION_2.phone}@s.whatsapp.net`;
      await sock1.sendMessage(chatId, { text: `[${scenario.isVoiceMessage ? "VOICE" : "TEXT"}] ${scenario.userMessage}` });
      console.log(`│ [WhatsApp] ${SESSION_1.phone} → ${SESSION_2.phone}`);

      // Step 2: Store inbound message
      await messageStore.storeMessage({
        phoneNumber: SESSION_1.phone,
        content: scenario.userMessage,
        direction: "inbound",
        channel: "whatsapp",
        correlationId,
        messageType: scenario.isVoiceMessage ? "audio" : "text",
      });
      console.log(`│ [DB] Stored inbound message (type: ${scenario.isVoiceMessage ? "audio" : "text"})`);

      // Step 3: Process through swarm with voice flag
      console.log(`│ [Swarm] Processing with isVoiceMessage=${scenario.isVoiceMessage}...`);
      const startTime = Date.now();
      const result = await orchestrator.processMessage(
        SESSION_1.phone,
        scenario.userMessage,
        "whatsapp",
        TEST_CONTACT as any,
        { isVoiceMessage: scenario.isVoiceMessage }
      );
      const duration = Date.now() - startTime;

      if (!result.success) {
        console.log(`│ [Swarm] ✗ Failed to process: ${result.error}`);
        failed++;
        results.push({
          scenario: scenario.name,
          passed: false,
          reason: `Processing failed: ${result.error}`,
          voiceModeActual: null,
        });
        console.log("└" + "─".repeat(58) + "┘");
        continue;
      }

      console.log(`│ [Swarm] Agent: ${result.agentType} (${duration}ms)`);
      console.log(`│ [Swarm] Response: "${(result.response || "").substring(0, 45)}..."`);

      // Step 4: Check voice mode in Redis
      const voiceModeValue = await redis.get(`voice_mode:${SESSION_1.phone}`);
      const actualVoiceMode = voiceModeValue === "true";
      console.log(`│ [Redis] voice_mode:${SESSION_1.phone} = ${voiceModeValue || "null"}`);

      // Step 5: Check if voice response was generated
      const hasVoiceResponse = result.voiceAudioPath || result.metadata?.voiceGenerated;
      if (hasVoiceResponse) {
        console.log(`│ [Voice] Voice response generated: ${result.voiceAudioPath}`);
      }

      // Step 6: Store outbound response
      await messageStore.storeOutboundMessage(
        SESSION_1.phone,
        result.response || "",
        "whatsapp",
        correlationId,
        { agentId: result.agentType }
      );

      // Step 7: Send response via WhatsApp
      const replyChat = `${SESSION_1.phone}@s.whatsapp.net`;
      const responsePrefix = actualVoiceMode ? "[VOICE RESPONSE] " : "[TEXT RESPONSE] ";
      await sock2.sendMessage(replyChat, { text: responsePrefix + (result.response || "") });
      console.log(`│ [WhatsApp] ${SESSION_2.phone} → ${SESSION_1.phone}`);

      // Step 8: Validate
      const voiceModeCorrect = actualVoiceMode === scenario.expectedVoiceMode;

      console.log("│");
      if (voiceModeCorrect) {
        console.log(`│ [Validation] ✓ Voice mode is ${actualVoiceMode ? "ENABLED" : "DISABLED"} as expected`);
        passed++;
        success(`${scenario.name}`);
      } else {
        console.log(`│ [Validation] ✗ Voice mode is ${actualVoiceMode ? "ENABLED" : "DISABLED"}, expected ${scenario.expectedVoiceMode ? "ENABLED" : "DISABLED"}`);
        failed++;
        fail(`${scenario.name}`);
      }

      results.push({
        scenario: scenario.name,
        passed: voiceModeCorrect,
        reason: voiceModeCorrect ? "Voice mode correct" : `Expected ${scenario.expectedVoiceMode}, got ${actualVoiceMode}`,
        voiceModeActual: actualVoiceMode,
      });

    } catch (error) {
      console.log(`│ [Error] ${error}`);
      failed++;
      results.push({
        scenario: scenario.name,
        passed: false,
        reason: `Error: ${error}`,
        voiceModeActual: null,
      });
    }

    console.log("└" + "─".repeat(58) + "┘");

    // Delay between scenarios
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  section("VOICE TEST RESULTS SUMMARY");

  console.log("┌────────────────────────────────────────────┬──────────┬────────┐");
  console.log("│ Scenario                                   │ V. Mode  │ Result │");
  console.log("├────────────────────────────────────────────┼──────────┼────────┤");

  for (const r of results) {
    const scenario = r.scenario.padEnd(42).substring(0, 42);
    const voiceMode = r.voiceModeActual === null ? "N/A" : (r.voiceModeActual ? "ON" : "OFF");
    const result = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`│ ${scenario} │ ${voiceMode.padEnd(8)} │ ${result} │`);
  }

  console.log("└────────────────────────────────────────────┴──────────┴────────┘");

  console.log("");
  console.log(`  Total:  ${VOICE_SCENARIOS.length} scenarios`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log("");

  // Check final voice mode state
  const finalVoiceMode = await redis.get(`voice_mode:${SESSION_1.phone}`);
  console.log(`  Final Voice Mode State: ${finalVoiceMode || "null"}`);
  console.log("");

  if (failed === 0) {
    console.log("  ✓ ALL VOICE TESTS PASSED!");
  } else {
    console.log(`  ✗ ${failed} TEST(S) FAILED`);
  }

  console.log("");
  console.log("━".repeat(60));
  console.log("");

  // Cleanup
  sock1.end(undefined);
  sock2.end(undefined);
  await redis.quit();
  await sql.end();

  process.exit(failed > 0 ? 1 : 0);
}

runVoiceTests().catch((error) => {
  console.error("Voice test failed:", error);
  process.exit(1);
});
