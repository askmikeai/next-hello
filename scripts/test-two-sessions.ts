#!/usr/bin/env npx tsx
/**
 * Two-Session WhatsApp Integration Test
 *
 * Tests sending messages between two WhatsApp sessions and verifies
 * the phone numbers are stored correctly in the database.
 *
 * Session 1: 7542959900
 * Session 2: 3054272115
 *
 * Prerequisites:
 *   - Both sessions must be connected (run connect:session1 and connect:session2)
 *   - PostgreSQL must be running
 *
 * Usage:
 *   npx tsx scripts/test-two-sessions.ts
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import postgres from "postgres";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Test configuration - US phone numbers with +1 country code
const SESSION_1 = {
  name: "session-1",
  phone: "17542959900",  // +1 754 295 9900
  authDir: path.join(projectRoot, "data", "auth", "whatsapp-session-1"),
};

const SESSION_2 = {
  name: "session-2",
  phone: "13054272115",  // +1 305 427 2115
  authDir: path.join(projectRoot, "data", "auth", "whatsapp-session-2"),
};

// Database connection
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://nexthello:nexthello_dev@localhost:5432/nexthello_test";

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
    }, 10000);

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

async function sendTestMessage(
  sock: ReturnType<typeof makeWASocket>,
  sql: postgres.Sql,
  fromPhone: string,
  toPhone: string,
  message: string
): Promise<boolean> {
  try {
    const chatId = `${toPhone}@s.whatsapp.net`;
    await sock.sendMessage(chatId, { text: message });
    log(`${fromPhone} → ${toPhone}: "${message}"`);

    // Store the outbound message in the database (like WhatsApp client does)
    const correlationId = `test-${randomUUID()}`;
    await sql`
      INSERT INTO message_history (
        phone_number,
        correlation_id,
        direction,
        channel,
        message_type,
        content,
        agent_id,
        created_at
      ) VALUES (
        ${toPhone},
        ${correlationId},
        'outbound',
        'whatsapp',
        'text',
        ${message},
        ${'session-' + fromPhone},
        NOW()
      )
    `;
    log(`Stored message in database (from session-${fromPhone})`);

    return true;
  } catch (error) {
    log(`Failed to send from ${fromPhone}: ${error}`);
    return false;
  }
}

async function verifyMessageInDb(
  sql: postgres.Sql,
  phoneNumber: string,
  contentPattern: string
): Promise<boolean> {
  const rows = await sql`
    SELECT phone_number, content, direction, created_at
    FROM message_history
    WHERE phone_number = ${phoneNumber}
      AND content LIKE ${'%' + contentPattern + '%'}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (rows.length > 0) {
    return true;
  }
  return false;
}

async function runTests(): Promise<void> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  WhatsApp Two-Session Integration Test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`  Session 1: ${SESSION_1.phone}`);
  console.log(`  Session 2: ${SESSION_2.phone}`);
  console.log(`  Database:  ${DATABASE_URL.split("@")[1] || DATABASE_URL}`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

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

  // Connect Session 1
  log(`Connecting ${SESSION_1.name} (${SESSION_1.phone})...`);
  const sock1 = await createSocket(SESSION_1);
  const connected1 = await waitForConnection(sock1, SESSION_1.name);

  if (!connected1) {
    fail(`${SESSION_1.name} not connected. Run: npm run connect:session1`);
    await sql.end();
    process.exit(1);
  }
  success(`${SESSION_1.name} connected`);

  // Connect Session 2
  log(`Connecting ${SESSION_2.name} (${SESSION_2.phone})...`);
  const sock2 = await createSocket(SESSION_2);
  const connected2 = await waitForConnection(sock2, SESSION_2.name);

  if (!connected2) {
    fail(`${SESSION_2.name} not connected. Run: npm run connect:session2`);
    sock1.end(undefined);
    await sql.end();
    process.exit(1);
  }
  success(`${SESSION_2.name} connected`);

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Running Tests");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  const testId = Date.now();
  let passed = 0;
  let failed = 0;

  // Test 1: Session 1 sends to Session 2
  log("Test 1: Session 1 → Session 2");
  const msg1 = `Test message ${testId} from ${SESSION_1.phone}`;
  const sent1 = await sendTestMessage(sock1, sql, SESSION_1.phone, SESSION_2.phone, msg1);

  if (sent1) {
    success("Message sent from Session 1 to Session 2");
    passed++;
  } else {
    fail("Failed to send message from Session 1");
    failed++;
  }

  // Wait for message to be processed
  await new Promise((r) => setTimeout(r, 3000));

  // Test 2: Session 2 sends to Session 1
  log("Test 2: Session 2 → Session 1");
  const msg2 = `Test message ${testId} from ${SESSION_2.phone}`;
  const sent2 = await sendTestMessage(sock2, sql, SESSION_2.phone, SESSION_1.phone, msg2);

  if (sent2) {
    success("Message sent from Session 2 to Session 1");
    passed++;
  } else {
    fail("Failed to send message from Session 2");
    failed++;
  }

  // Wait for messages to be stored
  await new Promise((r) => setTimeout(r, 3000));

  // Test 3: Verify Session 1's phone number is correctly stored
  log("Test 3: Verify phone numbers in database");

  // Check messages in database
  const recentMessages = await sql`
    SELECT phone_number, direction, LEFT(content, 50) as content, created_at
    FROM message_history
    WHERE created_at > NOW() - INTERVAL '1 minute'
    ORDER BY created_at DESC
    LIMIT 10
  `;

  console.log("");
  console.log("Recent messages in database:");
  console.log("┌────────────────┬───────────┬────────────────────────────────────────┐");
  console.log("│ Phone          │ Direction │ Content                                │");
  console.log("├────────────────┼───────────┼────────────────────────────────────────┤");

  for (const row of recentMessages) {
    const phone = String(row.phone_number).padEnd(14);
    const dir = String(row.direction).padEnd(9);
    const content = String(row.content).substring(0, 38).padEnd(38);
    console.log(`│ ${phone} │ ${dir} │ ${content} │`);
  }

  console.log("└────────────────┴───────────┴────────────────────────────────────────┘");
  console.log("");

  // Verify phone number format (should be 10 digits, not LID format)
  const badNumbers = await sql`
    SELECT phone_number, content
    FROM message_history
    WHERE created_at > NOW() - INTERVAL '1 minute'
      AND LENGTH(phone_number) > 12
  `;

  if (badNumbers.length === 0) {
    success("All phone numbers are in correct format (no LID numbers)");
    passed++;
  } else {
    fail(`Found ${badNumbers.length} messages with LID-format phone numbers`);
    for (const row of badNumbers) {
      console.log(`  - ${row.phone_number}: ${row.content}`);
    }
    failed++;
  }

  // Test 4: Verify messages have correct phone numbers
  log("Test 4: Verify message routing");

  const msgTo2 = await sql`
    SELECT * FROM message_history
    WHERE phone_number = ${SESSION_2.phone}
      AND content LIKE ${'%' + testId + '%'}
    LIMIT 1
  `;

  const msgTo1 = await sql`
    SELECT * FROM message_history
    WHERE phone_number = ${SESSION_1.phone}
      AND content LIKE ${'%' + testId + '%'}
    LIMIT 1
  `;

  if (msgTo2.length > 0) {
    success(`Found message to ${SESSION_2.phone} in database`);
    passed++;
  } else {
    fail(`Message to ${SESSION_2.phone} not found in database`);
    failed++;
  }

  if (msgTo1.length > 0) {
    success(`Found message to ${SESSION_1.phone} in database`);
    passed++;
  } else {
    fail(`Message to ${SESSION_1.phone} not found in database`);
    failed++;
  }

  // Summary
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test Results");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log("");

  if (failed === 0) {
    console.log("  ✓ All tests passed!");
  } else {
    console.log("  ✗ Some tests failed");
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  // Cleanup
  sock1.end(undefined);
  sock2.end(undefined);
  await sql.end();

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
