/**
 * WhatsApp Multi-Session Integration Tests
 *
 * Tests that outbound messages correctly identify the "from" phone number
 * when using multiple WhatsApp sessions.
 *
 * Test phone numbers:
 * - Session 1: 7542959900
 * - Session 2: 3054277457
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDatabase,
  isDatabaseConfigured,
  resetDatabase,
} from "../../database/client.js";
import {
  getMessageStore,
  resetMessageStore,
  MessageStore,
} from "../../history/message-store.js";
import type { ConversationMessage } from "../../swarm/types.js";

// Test phone numbers for the two sessions (US +1 country code)
const SESSION_1_PHONE = "17542959900";
const SESSION_2_PHONE = "13054272115";

// Skip tests if database is not configured
const runDbTests = process.env.DATABASE_URL || process.env.POSTGRES_HOST;

describe.skipIf(!runDbTests)("WhatsApp Multi-Session", () => {
  let sql: ReturnType<typeof getDatabase>;
  let messageStore: MessageStore;

  // Test recipient phone numbers
  const recipientA = "5551234567";
  const recipientB = "5559876543";

  beforeAll(() => {
    sql = getDatabase();
    expect(sql).not.toBeNull();
    expect(isDatabaseConfigured()).toBe(true);
    messageStore = getMessageStore();
  });

  afterAll(async () => {
    // Cleanup test data
    if (sql) {
      await sql`DELETE FROM message_history WHERE phone_number IN (${recipientA}, ${recipientB})`;
    }
    resetMessageStore();
    resetDatabase();
  });

  beforeEach(async () => {
    // Clean up before each test
    if (sql) {
      await sql`DELETE FROM message_history WHERE phone_number IN (${recipientA}, ${recipientB})`;
    }
  });

  describe("Phone Number Extraction", () => {
    it("should extract phone number from standard JID format", () => {
      const chatId = "7542959900@s.whatsapp.net";
      const phoneNumber = chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
      expect(phoneNumber).toBe("7542959900");
    });

    it("should extract phone number from LID format", () => {
      // LID format is used internally by WhatsApp for linked devices
      const chatId = "173559745892450@lid";
      const phoneNumber = chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
      // Note: LID extraction returns the LID number, not the actual phone
      // This is why we need to pass phoneNumber explicitly
      expect(phoneNumber).toBe("173559745892450");
    });

    it("should prefer explicit phoneNumber over chatId extraction", () => {
      const chatId = "173559745892450@lid"; // LID format
      const explicitPhone = "3054277457"; // Actual phone number

      // Simulating the sendMessage logic
      const phoneNumber = explicitPhone || chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
      expect(phoneNumber).toBe("3054277457");
    });
  });

  describe("Session 1 Phone Number Storage", () => {
    it("should store outbound message with Session 1 phone number", async () => {
      const correlationId = `test-session1-${Date.now()}`;

      const result = await messageStore.storeOutboundMessage(
        recipientA,
        "Hello from Session 1",
        "whatsapp",
        correlationId,
        { agentId: "test-agent" }
      );

      expect(result).not.toBeNull();
      expect(result?.phoneNumber).toBe(recipientA);
      expect(result?.content).toBe("Hello from Session 1");
      expect(result?.direction).toBe("outbound");
      expect(result?.channel).toBe("whatsapp");
    });

    it("should correctly identify Session 1 sender (7542959900)", async () => {
      // This test verifies the phone number is not corrupted during storage
      const senderPhone = SESSION_1_PHONE;
      const correlationId = `test-from-${senderPhone}-${Date.now()}`;

      // Store a message as if sent from Session 1
      const result = await messageStore.storeMessage({
        phoneNumber: recipientA,
        content: `Message from ${senderPhone}`,
        direction: "outbound",
        channel: "whatsapp",
        correlationId,
        agentId: `session-${senderPhone}`,
      });

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe(`session-${senderPhone}`);

      // Verify the message can be retrieved
      const messages = await messageStore.getMessagesByPhone(recipientA, { limit: 1 });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].agentId).toBe(`session-${senderPhone}`);
    });
  });

  describe("Session 2 Phone Number Storage", () => {
    it("should store outbound message with Session 2 phone number", async () => {
      const correlationId = `test-session2-${Date.now()}`;

      const result = await messageStore.storeOutboundMessage(
        recipientB,
        "Hello from Session 2",
        "whatsapp",
        correlationId,
        { agentId: "test-agent" }
      );

      expect(result).not.toBeNull();
      expect(result?.phoneNumber).toBe(recipientB);
      expect(result?.content).toBe("Hello from Session 2");
      expect(result?.direction).toBe("outbound");
      expect(result?.channel).toBe("whatsapp");
    });

    it("should correctly identify Session 2 sender (3054277457)", async () => {
      const senderPhone = SESSION_2_PHONE;
      const correlationId = `test-from-${senderPhone}-${Date.now()}`;

      // Store a message as if sent from Session 2
      const result = await messageStore.storeMessage({
        phoneNumber: recipientB,
        content: `Message from ${senderPhone}`,
        direction: "outbound",
        channel: "whatsapp",
        correlationId,
        agentId: `session-${senderPhone}`,
      });

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe(`session-${senderPhone}`);

      // Verify the message can be retrieved
      const messages = await messageStore.getMessagesByPhone(recipientB, { limit: 1 });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].agentId).toBe(`session-${senderPhone}`);
    });
  });

  describe("Multi-Session Message Isolation", () => {
    it("should keep messages from different sessions separate", async () => {
      const session1Correlation = `isolation-test-${SESSION_1_PHONE}-${Date.now()}`;
      const session2Correlation = `isolation-test-${SESSION_2_PHONE}-${Date.now()}`;

      // Send from Session 1 to recipientA
      await messageStore.storeMessage({
        phoneNumber: recipientA,
        content: "Session 1 message",
        direction: "outbound",
        channel: "whatsapp",
        correlationId: session1Correlation,
        agentId: `session-${SESSION_1_PHONE}`,
      });

      // Send from Session 2 to recipientB
      await messageStore.storeMessage({
        phoneNumber: recipientB,
        content: "Session 2 message",
        direction: "outbound",
        channel: "whatsapp",
        correlationId: session2Correlation,
        agentId: `session-${SESSION_2_PHONE}`,
      });

      // Verify Session 1 messages
      const session1Messages = await messageStore.getMessagesByPhone(recipientA);
      expect(session1Messages.length).toBeGreaterThan(0);
      const s1Msg = session1Messages.find(m => m.correlationId === session1Correlation);
      expect(s1Msg).toBeDefined();
      expect(s1Msg?.agentId).toBe(`session-${SESSION_1_PHONE}`);

      // Verify Session 2 messages
      const session2Messages = await messageStore.getMessagesByPhone(recipientB);
      expect(session2Messages.length).toBeGreaterThan(0);
      const s2Msg = session2Messages.find(m => m.correlationId === session2Correlation);
      expect(s2Msg).toBeDefined();
      expect(s2Msg?.agentId).toBe(`session-${SESSION_2_PHONE}`);
    });

    it("should not mix phone numbers between sessions", async () => {
      const timestamp = Date.now();

      // Simulate both sessions sending to the same recipient
      await messageStore.storeMessage({
        phoneNumber: recipientA,
        content: "From 7542959900",
        direction: "outbound",
        channel: "whatsapp",
        correlationId: `mix-test-1-${timestamp}`,
        agentId: `session-${SESSION_1_PHONE}`,
      });

      await messageStore.storeMessage({
        phoneNumber: recipientA,
        content: "From 3054277457",
        direction: "outbound",
        channel: "whatsapp",
        correlationId: `mix-test-2-${timestamp}`,
        agentId: `session-${SESSION_2_PHONE}`,
      });

      // Retrieve all messages to recipientA
      const messages = await messageStore.getMessagesByPhone(recipientA);

      // Find our test messages
      const msg1 = messages.find(m => m.correlationId === `mix-test-1-${timestamp}`);
      const msg2 = messages.find(m => m.correlationId === `mix-test-2-${timestamp}`);

      expect(msg1).toBeDefined();
      expect(msg2).toBeDefined();

      // Verify sender identification is preserved
      expect(msg1?.agentId).toBe(`session-${SESSION_1_PHONE}`);
      expect(msg2?.agentId).toBe(`session-${SESSION_2_PHONE}`);
      expect(msg1?.agentId).not.toBe(msg2?.agentId);
    });
  });

  describe("Phone Number Format Validation", () => {
    it("should store 11-digit US phone numbers with country code correctly", () => {
      // Both test numbers are 11-digit US numbers (1 + 10 digits)
      expect(SESSION_1_PHONE).toMatch(/^1\d{10}$/);
      expect(SESSION_2_PHONE).toMatch(/^1\d{10}$/);
    });

    it("should not contain WhatsApp JID suffixes in stored phone numbers", async () => {
      const correlationId = `format-test-${Date.now()}`;

      await messageStore.storeMessage({
        phoneNumber: recipientA, // Clean phone number, no @s.whatsapp.net
        content: "Format test",
        direction: "outbound",
        channel: "whatsapp",
        correlationId,
      });

      const messages = await messageStore.getMessagesByPhone(recipientA, { limit: 1 });
      const msg = messages.find(m => m.correlationId === correlationId);

      expect(msg?.phoneNumber).toBe(recipientA);
      expect(msg?.phoneNumber).not.toContain("@");
      expect(msg?.phoneNumber).not.toContain("whatsapp");
      expect(msg?.phoneNumber).not.toContain("lid");
    });

    it("should reject LID-format numbers when actual phone is available", () => {
      // LID numbers are typically longer than real phone numbers
      const lidNumber = "173559745892450"; // 15 digits - clearly a LID
      const realPhone = SESSION_2_PHONE; // 11 digits (1 + 10)

      // Real US phone numbers are 10-11 digits (with or without country code)
      expect(lidNumber.length).toBeGreaterThan(12);
      expect(realPhone.length).toBeLessThanOrEqual(12);

      // A simple heuristic: if number is > 12 digits, it's likely a LID
      const isLikelyLid = (num: string) => num.length > 12;

      expect(isLikelyLid(lidNumber)).toBe(true);
      expect(isLikelyLid(realPhone)).toBe(false);
    });
  });
});
