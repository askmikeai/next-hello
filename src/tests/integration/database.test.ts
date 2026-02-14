/**
 * Database Integration Tests
 *
 * Tests that message_history and agent_activity_log tables work correctly.
 * These tests require a running PostgreSQL database.
 *
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDatabase,
  isDatabaseConfigured,
  resetDatabase,
} from "../../database/client.js";
import { getMessageStore, resetMessageStore } from "../../history/message-store.js";
import {
  getActivityStore,
  resetActivityStore,
} from "../../observability/activity-store.js";
import { createCorrelationId } from "../../observability/logger.js";

// Skip tests if database is not configured
const runDbTests = process.env.DATABASE_URL || process.env.POSTGRES_HOST;

describe.skipIf(!runDbTests)("Database Integration", () => {
  let sql: ReturnType<typeof getDatabase>;
  const testPhone = "9999999999"; // Test phone number
  const testCorrelationId = createCorrelationId();

  beforeAll(() => {
    sql = getDatabase();
    expect(sql).not.toBeNull();
    expect(isDatabaseConfigured()).toBe(true);
  });

  afterAll(async () => {
    // Cleanup test data
    if (sql) {
      await sql`DELETE FROM message_history WHERE phone_number = ${testPhone}`;
      await sql`DELETE FROM agent_activity_log WHERE correlation_id LIKE 'test-%'`;
    }
    resetMessageStore();
    resetActivityStore();
    resetDatabase();
  });

  describe("MessageStore", () => {
    let messageStore: ReturnType<typeof getMessageStore>;

    beforeEach(() => {
      messageStore = getMessageStore();
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM message_history WHERE phone_number = ${testPhone}`;
      }
    });

    it("should store inbound messages", async () => {
      const result = await messageStore.storeInboundMessage(
        testPhone,
        "Test inbound message",
        "whatsapp",
        testCorrelationId
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBeDefined();
      expect(result?.direction).toBe("inbound");
      expect(result?.phoneNumber).toBe(testPhone);
      expect(result?.content).toBe("Test inbound message");
      expect(result?.channel).toBe("whatsapp");
    });

    it("should store outbound messages with metadata", async () => {
      const result = await messageStore.storeOutboundMessage(
        testPhone,
        "Test outbound message",
        "whatsapp",
        testCorrelationId,
        {
          agentId: "test-agent",
          modelUsed: "gpt-4",
          tokensUsed: 150,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.direction).toBe("outbound");
      expect(result?.agentId).toBe("test-agent");
      expect(result?.modelUsed).toBe("gpt-4");
      expect(result?.tokensUsed).toBe(150);
    });

    it("should retrieve messages by phone number", async () => {
      const messages = await messageStore.getMessagesByPhone(testPhone);

      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.every((m) => m.phoneNumber === testPhone)).toBe(true);
    });

    it("should retrieve messages by correlation ID", async () => {
      const messages = await messageStore.getMessagesByCorrelation(
        testCorrelationId
      );

      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.every((m) => m.correlationId === testCorrelationId)).toBe(
        true
      );
    });

    it("should count messages correctly", async () => {
      const count = await messageStore.countMessages(testPhone);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("should get recent messages in chronological order", async () => {
      const messages = await messageStore.getRecentMessages(testPhone, 10);

      expect(messages.length).toBeGreaterThan(0);
      // Should be in chronological order (oldest first)
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          messages[i - 1].createdAt.getTime()
        );
      }
    });
  });

  describe("ActivityStore", () => {
    let activityStore: ReturnType<typeof getActivityStore>;
    const activityCorrelationId = `test-${Date.now()}`;

    beforeEach(() => {
      activityStore = getActivityStore();
    });

    afterAll(async () => {
      if (sql) {
        await sql`DELETE FROM agent_activity_log WHERE correlation_id = ${activityCorrelationId}`;
      }
    });

    it("should start and complete an activity", async () => {
      const activityId = await activityStore.startActivity({
        correlationId: activityCorrelationId,
        agentType: "conversation",
        action: "test_process",
      });

      expect(activityId).not.toBeNull();

      const completed = await activityStore.completeActivity(activityId!, {
        status: "completed",
        durationMs: 1234,
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(completed).toBe(true);
    });

    it("should log activity in one call", async () => {
      const activityId = await activityStore.logActivity({
        correlationId: activityCorrelationId,
        agentType: "research",
        action: "test_research",
        status: "completed",
        durationMs: 567,
        inputTokens: 200,
        outputTokens: 100,
      });

      expect(activityId).not.toBeNull();
    });

    it("should log failed activities with error message", async () => {
      const activityId = await activityStore.logActivity({
        correlationId: activityCorrelationId,
        agentType: "qualification",
        action: "test_fail",
        status: "failed",
        durationMs: 100,
        errorMessage: "Test error message",
      });

      expect(activityId).not.toBeNull();
    });

    it("should retrieve activities by correlation ID", async () => {
      const activities = await activityStore.getActivitiesByCorrelation(
        activityCorrelationId
      );

      expect(activities.length).toBeGreaterThanOrEqual(3);
      expect(
        activities.every((a) => a.correlationId === activityCorrelationId)
      ).toBe(true);
    });

    it("should get recent activities by agent type", async () => {
      const conversationActivities = await activityStore.getRecentActivities(
        "conversation",
        10
      );

      expect(
        conversationActivities.every((a) => a.agentType === "conversation")
      ).toBe(true);
    });

    it("should get recent activities across all types", async () => {
      const allActivities = await activityStore.getRecentActivities(
        undefined,
        50
      );

      expect(allActivities.length).toBeGreaterThan(0);
    });

    it("should track voice agent activities", async () => {
      const activityId = await activityStore.logActivity({
        correlationId: activityCorrelationId,
        agentType: "voice",
        action: "generate_voice",
        status: "completed",
        durationMs: 2500,
      });

      expect(activityId).not.toBeNull();

      const activities = await activityStore.getRecentActivities("voice", 10);
      expect(activities.some((a) => a.action === "generate_voice")).toBe(true);
    });
  });
});

describe.skipIf(runDbTests)("Database Integration (Skipped)", () => {
  it("skips database tests when not configured", () => {
    console.log(
      "Database tests skipped - set DATABASE_URL or POSTGRES_* env vars to run"
    );
    expect(true).toBe(true);
  });
});
