/**
 * Admin API Unit Tests
 *
 * Tests the admin API functions for the dashboard.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("../../database/client.js", () => ({
  getDatabase: vi.fn(),
  checkDatabaseHealth: vi.fn(),
}));

vi.mock("../../queue/client.js", () => ({
  checkRedisHealth: vi.fn(),
  getQueueStats: vi.fn(),
  addJob: vi.fn(),
  getRedisConnection: vi.fn(),
}));

vi.mock("../../observability/activity-store.js", () => ({
  getActivityStore: vi.fn().mockReturnValue({
    getRecentActivities: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../../history/message-store.js", () => ({
  getMessageStore: vi.fn().mockReturnValue({
    getMessagesByContact: vi.fn().mockResolvedValue([]),
    getMessagesByPhone: vi.fn().mockResolvedValue([]),
  }),
}));

import {
  getStats,
  getContacts,
  getContactById,
  getActivities,
  getMessages,
  getQueues,
  getHealth,
  sendVoice,
  sendVideo,
  getSwarmStates,
  getAgentStats,
} from "../../admin/api.js";
import { getDatabase, checkDatabaseHealth } from "../../database/client.js";
import { checkRedisHealth, getQueueStats, addJob, getRedisConnection } from "../../queue/client.js";
import { getActivityStore } from "../../observability/activity-store.js";

describe("Admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getStats", () => {
    it("should return empty stats when database unavailable", async () => {
      vi.mocked(getDatabase).mockReturnValue(null);

      const result = await getStats();

      expect(result).toEqual({
        total: 0,
        byStatus: {},
        byQualification: {},
      });
    });

    it("should return stats from database", async () => {
      const mockSql = vi.fn()
        .mockResolvedValueOnce([
          { status: "new", count: "10" },
          { status: "qualified", count: "20" },
        ])
        .mockResolvedValueOnce([
          { tier: "hot", count: "5" },
          { tier: "warm", count: "15" },
          { tier: "cold", count: "10" },
        ]);

      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getStats();

      expect(result.total).toBe(30);
      expect(result.byStatus).toEqual({
        new: 10,
        qualified: 20,
      });
      expect(result.byQualification).toEqual({
        hot: 5,
        warm: 15,
        cold: 10,
      });
    });

    it("should handle database errors gracefully", async () => {
      const mockSql = vi.fn().mockRejectedValue(new Error("DB Error"));
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getStats();

      expect(result).toEqual({
        total: 0,
        byStatus: {},
        byQualification: {},
      });
    });
  });

  describe("getContacts", () => {
    it("should return empty array when database unavailable", async () => {
      vi.mocked(getDatabase).mockReturnValue(null);

      const result = await getContacts();

      expect(result).toEqual([]);
    });

    it("should return contacts from database", async () => {
      const mockContacts = [
        { id: "1", phone_number: "+1555123456", first_name: "John" },
        { id: "2", phone_number: "+1555234567", first_name: "Jane" },
      ];
      const mockSql = vi.fn().mockResolvedValue(mockContacts);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getContacts(10);

      expect(result).toEqual(mockContacts);
    });

    it("should filter by status when provided", async () => {
      const mockContacts = [{ id: "1", status: "qualified" }];
      const mockSql = vi.fn().mockResolvedValue(mockContacts);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getContacts(10, "qualified");

      expect(result).toEqual(mockContacts);
    });
  });

  describe("getContactById", () => {
    it("should return null when database unavailable", async () => {
      vi.mocked(getDatabase).mockReturnValue(null);

      const result = await getContactById("123");

      expect(result).toBeNull();
    });

    it("should return contact from database", async () => {
      const mockContact = { id: "123", phone_number: "+1555123456" };
      const mockSql = vi.fn().mockResolvedValue([mockContact]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getContactById("123");

      expect(result).toEqual(mockContact);
    });

    it("should return null when contact not found", async () => {
      const mockSql = vi.fn().mockResolvedValue([]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getContactById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getActivities", () => {
    it("should return activities from store", async () => {
      const mockActivities = [
        { id: "1", agentType: "orchestrator", action: "process" },
      ];
      const mockStore = {
        getRecentActivities: vi.fn().mockResolvedValue(mockActivities),
      };
      vi.mocked(getActivityStore).mockReturnValue(mockStore as any);

      const result = await getActivities(20);

      expect(result).toEqual(mockActivities);
      expect(mockStore.getRecentActivities).toHaveBeenCalledWith(undefined, 20);
    });

    it("should filter by agent type", async () => {
      const mockActivities = [{ id: "1", agentType: "orchestrator" }];
      const mockStore = {
        getRecentActivities: vi.fn().mockResolvedValue(mockActivities),
      };
      vi.mocked(getActivityStore).mockReturnValue(mockStore as any);

      await getActivities(20, "orchestrator");

      expect(mockStore.getRecentActivities).toHaveBeenCalledWith("orchestrator", 20);
    });
  });

  describe("getQueues", () => {
    it("should return stats for all queues", async () => {
      vi.mocked(getQueueStats).mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 1,
        delayed: 0,
      });

      const result = await getQueues();

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("waiting");
      expect(result[0]).toHaveProperty("active");
    });
  });

  describe("getHealth", () => {
    it("should return health status for all services", async () => {
      vi.mocked(checkRedisHealth).mockResolvedValue({
        connected: true,
        latencyMs: 5,
      });
      vi.mocked(checkDatabaseHealth).mockResolvedValue({
        healthy: true,
        latencyMs: 10,
      });

      const result = await getHealth();

      expect(result.redis.connected).toBe(true);
      expect(result.postgres.healthy).toBe(true);
    });

    it("should handle service errors", async () => {
      vi.mocked(checkRedisHealth).mockResolvedValue({
        connected: false,
        latencyMs: 0,
        error: "Connection refused",
      });
      vi.mocked(checkDatabaseHealth).mockResolvedValue({
        healthy: false,
        error: "Timeout",
      });

      const result = await getHealth();

      expect(result.redis.connected).toBe(false);
      expect(result.redis.error).toBe("Connection refused");
      expect(result.postgres.healthy).toBe(false);
    });
  });

  describe("sendVoice", () => {
    it("should return error for nonexistent contact", async () => {
      const mockSql = vi.fn().mockResolvedValue([]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await sendVoice("nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Contact not found");
    });

    it("should return error for contact without phone", async () => {
      const mockSql = vi.fn().mockResolvedValue([{ id: "123", phone_number: null }]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await sendVoice("123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Contact has no phone number");
    });

    it("should queue voice job successfully", async () => {
      const mockContact = {
        id: "123",
        phone_number: "+1555123456",
        first_name: "John",
      };
      const mockSql = vi.fn().mockResolvedValue([mockContact]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);
      vi.mocked(addJob).mockResolvedValue({ id: "job-123" } as any);

      const result = await sendVoice("123");

      expect(result.success).toBe(true);
      expect(result.jobId).toBe("job-123");
      expect(addJob).toHaveBeenCalledWith("voice-generation", expect.objectContaining({
        contactId: "123",
        phoneNumber: "+1555123456",
      }));
    });

    it("should handle queue errors", async () => {
      const mockContact = { id: "123", phone_number: "+1555123456" };
      const mockSql = vi.fn().mockResolvedValue([mockContact]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);
      vi.mocked(addJob).mockResolvedValue(null);

      const result = await sendVoice("123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Redis unavailable");
    });
  });

  describe("sendVideo", () => {
    it("should return error for nonexistent contact", async () => {
      const mockSql = vi.fn().mockResolvedValue([]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await sendVideo("nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Contact not found");
    });

    it("should queue video job successfully", async () => {
      const mockContact = {
        id: "123",
        phone_number: "+1555123456",
        first_name: "John",
      };
      const mockSql = vi.fn().mockResolvedValue([mockContact]);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);
      vi.mocked(addJob).mockResolvedValue({ id: "job-456" } as any);

      const result = await sendVideo("123");

      expect(result.success).toBe(true);
      expect(result.jobId).toBe("job-456");
      expect(addJob).toHaveBeenCalledWith("video-generation", expect.objectContaining({
        contactId: "123",
        phoneNumber: "+1555123456",
      }));
    });
  });

  describe("getSwarmStates", () => {
    it("should return empty array when Redis unavailable", async () => {
      vi.mocked(getRedisConnection).mockReturnValue(null);

      const result = await getSwarmStates();

      expect(result).toEqual([]);
    });

    it("should return swarm states from Redis", async () => {
      const mockState = {
        correlationId: "corr-1",
        phoneNumber: "+1555123456",
        currentAgent: "orchestrator",
        conversationTurns: 5,
        lastActivityAt: new Date().toISOString(),
        taskQueue: [],
        channel: "whatsapp",
      };

      const mockRedis = {
        keys: vi.fn().mockResolvedValue(["swarm:state:+1555123456"]),
        get: vi.fn().mockResolvedValue(JSON.stringify(mockState)),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const result = await getSwarmStates();

      expect(result.length).toBe(1);
      expect(result[0].phoneNumber).toBe("+1555123456");
      expect(result[0].conversationTurns).toBe(5);
    });

    it("should handle Redis errors gracefully", async () => {
      const mockRedis = {
        keys: vi.fn().mockRejectedValue(new Error("Redis error")),
      };
      vi.mocked(getRedisConnection).mockReturnValue(mockRedis as any);

      const result = await getSwarmStates();

      expect(result).toEqual([]);
    });
  });

  describe("getAgentStats", () => {
    it("should return empty array when database unavailable", async () => {
      vi.mocked(getDatabase).mockReturnValue(null);

      const result = await getAgentStats();

      expect(result).toEqual([]);
    });

    it("should return agent stats from database", async () => {
      const mockStats = [
        { agent_type: "orchestrator", executions: "100", avg_duration: "250", success_rate: "98.5" },
        { agent_type: "video", executions: "20", avg_duration: "5000", success_rate: "85.0" },
      ];
      const mockSql = vi.fn().mockResolvedValue(mockStats);
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getAgentStats();

      expect(result.length).toBe(2);
      expect(result[0].agentType).toBe("orchestrator");
      expect(result[0].executions).toBe(100);
      expect(result[0].avgDurationMs).toBe(250);
      expect(result[0].successRate).toBe(98.5);
    });

    it("should handle database errors", async () => {
      const mockSql = vi.fn().mockRejectedValue(new Error("DB Error"));
      vi.mocked(getDatabase).mockReturnValue(mockSql as any);

      const result = await getAgentStats();

      expect(result).toEqual([]);
    });
  });
});
