/**
 * PDL Queue Unit Tests
 *
 * Tests the queued PDL enrichment functions with mocked dependencies.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the queue client
vi.mock("../../queue/client.js", () => ({
  isRedisAvailable: vi.fn(),
  getQueue: vi.fn(),
  getQueueEvents: vi.fn(),
}));

// Mock the PDL client
vi.mock("../../integrations/pdl/client.js", () => ({
  enrichPerson: vi.fn(),
  enrichCompany: vi.fn(),
}));

import {
  enrichPersonQueued,
  enrichCompanyQueued,
  enrichContactQueued,
  enqueuePersonEnrichment,
} from "../../integrations/pdl/queue.js";
import { isRedisAvailable, getQueue, getQueueEvents } from "../../queue/client.js";
import { enrichPerson, enrichCompany } from "../../integrations/pdl/client.js";

describe("PDL Queue Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("enrichPersonQueued", () => {
    it("should fall back to direct call when Redis unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(false);
      vi.mocked(enrichPerson).mockResolvedValue({
        success: true,
        status: 200,
        likelihood: 8,
        data: { id: "123", full_name: "Test User", first_name: "Test", last_name: "User" },
      });

      const result = await enrichPersonQueued({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(isRedisAvailable).toHaveBeenCalled();
      expect(enrichPerson).toHaveBeenCalledWith({ email: "test@example.com" });
    });

    it("should fall back to direct call when queue unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(null);
      vi.mocked(enrichPerson).mockResolvedValue({
        success: true,
        status: 200,
        data: { id: "123", full_name: "Test", first_name: "Test", last_name: "User" },
      });

      const result = await enrichPersonQueued({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(enrichPerson).toHaveBeenCalled();
    });

    it("should fall back when queueEvents unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue({} as never);
      vi.mocked(getQueueEvents).mockReturnValue(null);
      vi.mocked(enrichPerson).mockResolvedValue({
        success: true,
        status: 200,
        data: { id: "123", full_name: "Test", first_name: "Test", last_name: "User" },
      });

      const result = await enrichPersonQueued({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(enrichPerson).toHaveBeenCalled();
    });

    it("should add job to queue and wait for result", async () => {
      const mockJob = {
        id: "job-123",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: true,
          type: "person",
          personResult: {
            success: true,
            status: 200,
            data: { id: "123", full_name: "Queued User", first_name: "Queued", last_name: "User" },
          },
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      const mockQueueEvents = {};

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue(mockQueueEvents as never);

      const result = await enrichPersonQueued(
        { email: "test@example.com" },
        { correlationId: "test-corr-123" }
      );

      expect(result.success).toBe(true);
      expect(result.data?.full_name).toBe("Queued User");
      expect(mockQueue.add).toHaveBeenCalledWith(
        "pdl-enrichment",
        expect.objectContaining({
          type: "person",
          correlationId: "test-corr-123",
          personParams: { email: "test@example.com" },
        }),
        expect.any(Object)
      );
    });

    it("should handle job failure gracefully", async () => {
      const mockJob = {
        id: "job-123",
        waitUntilFinished: vi.fn().mockRejectedValue(new Error("Job timed out")),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichPersonQueued({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("Job failed");
    });

    it("should handle missing personResult in job result", async () => {
      const mockJob = {
        id: "job-123",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: false,
          type: "person",
          error: "Some error",
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichPersonQueued({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Some error");
    });
  });

  describe("enrichCompanyQueued", () => {
    it("should fall back to direct call when Redis unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(false);
      vi.mocked(enrichCompany).mockResolvedValue({
        success: true,
        status: 200,
        data: { id: "123", name: "Test Company" },
      });

      const result = await enrichCompanyQueued({ name: "Acme" });

      expect(result.success).toBe(true);
      expect(enrichCompany).toHaveBeenCalledWith({ name: "Acme" });
    });

    it("should add company job to queue", async () => {
      const mockJob = {
        id: "job-456",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: true,
          type: "company",
          companyResult: {
            success: true,
            status: 200,
            data: { id: "123", name: "Queued Company", industry: "Tech" },
          },
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichCompanyQueued({ name: "Test Corp" });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Queued Company");
      expect(mockQueue.add).toHaveBeenCalledWith(
        "pdl-enrichment",
        expect.objectContaining({
          type: "company",
          companyParams: { name: "Test Corp" },
        }),
        expect.any(Object)
      );
    });

    it("should handle missing companyResult in job result", async () => {
      const mockJob = {
        id: "job-456",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: false,
          type: "company",
          error: "Company lookup failed",
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichCompanyQueued({ name: "Unknown Corp" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe("Company lookup failed");
    });

    it("should handle job failure/timeout for company enrichment", async () => {
      const mockJob = {
        id: "job-456",
        waitUntilFinished: vi.fn().mockRejectedValue(new Error("Job timed out")),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichCompanyQueued({ name: "Test Corp" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("Job failed");
    });
  });

  describe("enrichContactQueued", () => {
    beforeEach(() => {
      // Set up queue mocks for all enrichContactQueued tests
      vi.mocked(isRedisAvailable).mockReturnValue(true);
    });

    it("should try LinkedIn first", async () => {
      const mockJob = {
        id: "job-789",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: true,
          type: "person",
          personResult: {
            success: true,
            status: 200,
            data: { id: "123", full_name: "LinkedIn User", first_name: "LinkedIn", last_name: "User" },
          },
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichContactQueued({
        linkedinUrl: "https://linkedin.com/in/test",
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      // Should only make one call (LinkedIn succeeded)
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        "pdl-enrichment",
        expect.objectContaining({
          personParams: { profile: "https://linkedin.com/in/test" },
        }),
        expect.any(Object)
      );
    });

    it("should fall back to email when LinkedIn fails", async () => {
      let callCount = 0;
      const mockJob = {
        id: "job-fallback",
        waitUntilFinished: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // LinkedIn fails
            return Promise.resolve({
              success: false,
              type: "person",
              personResult: { success: false, status: 404, error: "Not found" },
            });
          }
          // Email succeeds
          return Promise.resolve({
            success: true,
            type: "person",
            personResult: {
              success: true,
              status: 200,
              data: { id: "123", full_name: "Email User", first_name: "Email", last_name: "User" },
            },
          });
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichContactQueued({
        linkedinUrl: "https://linkedin.com/in/unknown",
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
    });

    it("should normalize phone number", async () => {
      const mockJob = {
        id: "job-phone",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: true,
          type: "person",
          personResult: {
            success: true,
            status: 200,
            data: { id: "123", full_name: "Phone User", first_name: "Phone", last_name: "User" },
          },
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      await enrichContactQueued({ phone: "5551234567" });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "pdl-enrichment",
        expect.objectContaining({
          personParams: { phone: "+5551234567" },
        }),
        expect.any(Object)
      );
    });

    it("should return 404 when all methods fail", async () => {
      const mockJob = {
        id: "job-all-fail",
        waitUntilFinished: vi.fn().mockResolvedValue({
          success: false,
          type: "person",
          personResult: { success: false, status: 404, error: "Not found" },
        }),
      };

      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(getQueue).mockReturnValue(mockQueue as never);
      vi.mocked(getQueueEvents).mockReturnValue({} as never);

      const result = await enrichContactQueued({
        email: "unknown@example.com",
        phone: "+10000000000",
        firstName: "Unknown",
        lastName: "Person",
        company: "Nowhere",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });
  });

  describe("enqueuePersonEnrichment", () => {
    it("should return error when Redis unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(false);

      const result = await enqueuePersonEnrichment({ email: "test@example.com" });

      expect(result.enqueued).toBe(false);
      expect(result.error).toContain("Redis unavailable");
    });

    it("should return error when queue unavailable", async () => {
      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(null);

      const result = await enqueuePersonEnrichment({ email: "test@example.com" });

      expect(result.enqueued).toBe(false);
      expect(result.error).toContain("Queue unavailable");
    });

    it("should enqueue job and return job ID", async () => {
      const mockJob = { id: "enqueued-job-123" };
      const mockQueue = {
        add: vi.fn().mockResolvedValue(mockJob),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);

      const result = await enqueuePersonEnrichment(
        { email: "test@example.com" },
        "my-correlation-id"
      );

      expect(result.enqueued).toBe(true);
      expect(result.jobId).toBe("enqueued-job-123");
    });

    it("should handle queue.add errors", async () => {
      const mockQueue = {
        add: vi.fn().mockRejectedValue(new Error("Queue error")),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);

      const result = await enqueuePersonEnrichment({ email: "test@example.com" });

      expect(result.enqueued).toBe(false);
      expect(result.error).toContain("Queue error");
    });

    it("should generate correlation ID if not provided", async () => {
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: "job-123" }),
      };

      vi.mocked(isRedisAvailable).mockReturnValue(true);
      vi.mocked(getQueue).mockReturnValue(mockQueue as never);

      await enqueuePersonEnrichment({ email: "test@example.com" });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "pdl-enrichment",
        expect.objectContaining({
          correlationId: expect.any(String),
        }),
        expect.any(Object)
      );
    });
  });
});
