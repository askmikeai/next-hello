/**
 * Message Store Integration Tests
 *
 * Tests the message history persistence layer.
 * Requires: docker compose up postgres -d
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { uniquePhone } from "../setup.js";

// Set up environment before importing modules
process.env.DATABASE_URL = "postgresql://nexthello:nexthello_dev@localhost:5432/nexthello";

import {
  MessageStore,
  getMessageStore,
  resetMessageStore,
} from "../../src/history/message-store.js";
import { checkDatabaseHealth, resetDatabase, getDatabase } from "../../src/database/client.js";

describe("Message Store Integration Tests", () => {
  let store: MessageStore;
  const testPhones: string[] = [];

  beforeAll(async () => {
    // Verify database is available
    const health = await checkDatabaseHealth();
    if (!health.healthy) {
      throw new Error(
        `Database not available: ${health.error}. Run 'docker compose up postgres -d' first.`
      );
    }

    resetMessageStore();
    store = getMessageStore();
  });

  afterAll(async () => {
    // Clean up test messages
    const sql = getDatabase();
    if (sql) {
      for (const phone of testPhones) {
        await sql`DELETE FROM message_history WHERE phone_number = ${phone}`;
      }
    }
    resetMessageStore();
    resetDatabase();
  });

  describe("isConfigured", () => {
    it("should return true when database is configured", () => {
      expect(store.isConfigured()).toBe(true);
    });
  });

  describe("storeMessage", () => {
    it("should store an inbound message", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const message = await store.storeMessage({
        phoneNumber: phone,
        correlationId: "test-corr-1",
        direction: "inbound",
        channel: "whatsapp",
        content: "Hello from test!",
      });

      expect(message).not.toBeNull();
      expect(message?.phoneNumber).toBe(phone);
      expect(message?.direction).toBe("inbound");
      expect(message?.channel).toBe("whatsapp");
      expect(message?.content).toBe("Hello from test!");
      expect(message?.id).toBeDefined();
      expect(message?.createdAt).toBeInstanceOf(Date);
    });

    it("should store an outbound message with agent info", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const message = await store.storeMessage({
        phoneNumber: phone,
        correlationId: "test-corr-2",
        direction: "outbound",
        channel: "whatsapp",
        content: "Hi there! How can I help?",
        agentId: "conversation",
        modelUsed: "claude-3-sonnet",
        tokensUsed: 150,
      });

      expect(message).not.toBeNull();
      expect(message?.direction).toBe("outbound");
      expect(message?.agentId).toBe("conversation");
      expect(message?.modelUsed).toBe("claude-3-sonnet");
      expect(message?.tokensUsed).toBe(150);
    });

    it("should store message with tool calls", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const toolCalls = [
        { name: "contact_lookup", args: { phone }, result: { found: true } },
      ];

      const message = await store.storeMessage({
        phoneNumber: phone,
        correlationId: "test-corr-3",
        direction: "outbound",
        channel: "whatsapp",
        content: "Looking up your info...",
        toolCalls,
      });

      expect(message?.toolCalls).toBeDefined();
      expect(message?.toolCalls).toHaveLength(1);
      expect(message?.toolCalls?.[0].name).toBe("contact_lookup");
    });
  });

  describe("storeInboundMessage / storeOutboundMessage", () => {
    it("should store inbound message with helper", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const message = await store.storeInboundMessage(
        phone,
        "Inbound test message",
        "whatsapp",
        "corr-inbound-1"
      );

      expect(message?.direction).toBe("inbound");
      expect(message?.content).toBe("Inbound test message");
    });

    it("should store outbound message with helper", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const message = await store.storeOutboundMessage(
        phone,
        "Outbound test message",
        "whatsapp",
        "corr-outbound-1",
        { agentId: "test-agent" }
      );

      expect(message?.direction).toBe("outbound");
      expect(message?.content).toBe("Outbound test message");
      expect(message?.agentId).toBe("test-agent");
    });
  });

  describe("getMessagesByPhone", () => {
    it("should retrieve messages for a phone number", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      // Store multiple messages
      await store.storeInboundMessage(phone, "Message 1", "whatsapp", "corr-1");
      await store.storeOutboundMessage(phone, "Message 2", "whatsapp", "corr-1");
      await store.storeInboundMessage(phone, "Message 3", "whatsapp", "corr-1");

      const messages = await store.getMessagesByPhone(phone);

      expect(messages.length).toBe(3);
    });

    it("should order messages by created_at descending by default", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      await store.storeInboundMessage(phone, "First", "whatsapp", "corr-order");
      await new Promise((r) => setTimeout(r, 10)); // Small delay
      await store.storeInboundMessage(phone, "Second", "whatsapp", "corr-order");
      await new Promise((r) => setTimeout(r, 10));
      await store.storeInboundMessage(phone, "Third", "whatsapp", "corr-order");

      const messages = await store.getMessagesByPhone(phone, { order: "desc" });

      expect(messages[0].content).toBe("Third");
      expect(messages[2].content).toBe("First");
    });

    it("should respect limit parameter", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      for (let i = 0; i < 10; i++) {
        await store.storeInboundMessage(phone, `Message ${i}`, "whatsapp", "corr-limit");
      }

      const messages = await store.getMessagesByPhone(phone, { limit: 5 });

      expect(messages.length).toBe(5);
    });

    it("should support pagination with offset", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      for (let i = 0; i < 10; i++) {
        await store.storeInboundMessage(phone, `Message ${i}`, "whatsapp", "corr-page");
      }

      const page1 = await store.getMessagesByPhone(phone, { limit: 3, offset: 0 });
      const page2 = await store.getMessagesByPhone(phone, { limit: 3, offset: 3 });

      expect(page1.length).toBe(3);
      expect(page2.length).toBe(3);
      // Ensure no overlap (different messages)
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe("getRecentMessages", () => {
    it("should return messages in chronological order", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      await store.storeInboundMessage(phone, "First", "whatsapp", "corr-recent");
      await new Promise((r) => setTimeout(r, 10));
      await store.storeInboundMessage(phone, "Second", "whatsapp", "corr-recent");
      await new Promise((r) => setTimeout(r, 10));
      await store.storeInboundMessage(phone, "Third", "whatsapp", "corr-recent");

      const recent = await store.getRecentMessages(phone, 10);

      // Should be in chronological order (oldest first)
      expect(recent[0].content).toBe("First");
      expect(recent[2].content).toBe("Third");
    });
  });

  describe("getMessagesByCorrelation", () => {
    it("should retrieve messages by correlation ID", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);
      const correlationId = `corr-${Date.now()}`;

      await store.storeInboundMessage(phone, "Msg 1", "whatsapp", correlationId);
      await store.storeOutboundMessage(phone, "Msg 2", "whatsapp", correlationId);
      await store.storeInboundMessage(phone, "Different corr", "whatsapp", "other-corr");

      const messages = await store.getMessagesByCorrelation(correlationId);

      expect(messages.length).toBe(2);
      expect(messages.every((m) => m.correlationId === correlationId)).toBe(true);
    });
  });

  describe("countMessages", () => {
    it("should count messages for a phone number", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      await store.storeInboundMessage(phone, "1", "whatsapp", "corr-count");
      await store.storeInboundMessage(phone, "2", "whatsapp", "corr-count");
      await store.storeInboundMessage(phone, "3", "whatsapp", "corr-count");

      const count = await store.countMessages(phone);

      expect(count).toBe(3);
    });

    it("should return 0 for phone with no messages", async () => {
      const count = await store.countMessages("+19999999999");
      expect(count).toBe(0);
    });
  });

  describe("deleteOldMessages", () => {
    it("should delete old messages keeping specified count", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      // Create 10 messages
      for (let i = 0; i < 10; i++) {
        await store.storeInboundMessage(phone, `Message ${i}`, "whatsapp", "corr-delete");
      }

      // Keep only 3
      const deleted = await store.deleteOldMessages(phone, 3);

      expect(deleted).toBe(7);

      const remaining = await store.countMessages(phone);
      expect(remaining).toBe(3);
    });
  });

  describe("Channel support", () => {
    it("should support whatsapp channel", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const msg = await store.storeInboundMessage(phone, "WhatsApp msg", "whatsapp", "corr-wa");
      expect(msg?.channel).toBe("whatsapp");
    });

    it("should support telegram channel", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const msg = await store.storeInboundMessage(phone, "Telegram msg", "telegram", "corr-tg");
      expect(msg?.channel).toBe("telegram");
    });

    it("should support email channel", async () => {
      const phone = uniquePhone();
      testPhones.push(phone);

      const msg = await store.storeInboundMessage(phone, "Email msg", "email", "corr-email");
      expect(msg?.channel).toBe("email");
    });
  });
});
