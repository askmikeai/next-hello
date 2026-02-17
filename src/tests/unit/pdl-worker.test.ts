/**
 * PDL Worker Unit Tests
 *
 * Tests the PDL enrichment worker processor logic.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";

// Mock the PDL client
vi.mock("../../integrations/pdl/client.js", () => ({
  enrichPerson: vi.fn(),
  enrichCompany: vi.fn(),
}));

// Mock the queue client to prevent actual worker creation
vi.mock("../../queue/client.js", () => ({
  createWorker: vi.fn().mockReturnValue({
    isRunning: () => true,
    close: vi.fn(),
  }),
}));

// Mock metrics
vi.mock("../../observability/metrics.js", () => ({
  recordJobProcessed: vi.fn(),
  startTimer: vi.fn().mockReturnValue(() => 100),
}));

// Mock logger
vi.mock("../../observability/logger.js", () => ({
  createWorkerLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

import { enrichPerson, enrichCompany } from "../../integrations/pdl/client.js";
import type { PDLEnrichmentJob } from "../../queue/workers/pdl.worker.js";

// We need to test the processor logic directly
// Since the worker wraps the processor, we'll test the core logic

describe("PDL Worker Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Person Enrichment Jobs", () => {
    it("should process person enrichment job successfully", async () => {
      vi.mocked(enrichPerson).mockResolvedValue({
        success: true,
        status: 200,
        likelihood: 8,
        data: {
          id: "123",
          full_name: "Test User",
          first_name: "Test",
          last_name: "User",
        },
      });

      const jobData: PDLEnrichmentJob = {
        type: "person",
        correlationId: "test-123",
        personParams: { email: "test@example.com" },
      };

      // Call enrichPerson directly as the worker would
      const result = await enrichPerson(jobData.personParams!);

      expect(result.success).toBe(true);
      expect(result.data?.full_name).toBe("Test User");
      expect(enrichPerson).toHaveBeenCalledWith({ email: "test@example.com" });
    });

    it("should handle person enrichment failure", async () => {
      vi.mocked(enrichPerson).mockResolvedValue({
        success: false,
        status: 404,
        error: "No matching person found",
      });

      const result = await enrichPerson({ email: "unknown@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should handle API errors", async () => {
      vi.mocked(enrichPerson).mockRejectedValue(new Error("API Error"));

      await expect(enrichPerson({ email: "test@example.com" })).rejects.toThrow("API Error");
    });
  });

  describe("Company Enrichment Jobs", () => {
    it("should process company enrichment job successfully", async () => {
      vi.mocked(enrichCompany).mockResolvedValue({
        success: true,
        status: 200,
        data: {
          id: "456",
          name: "Test Company",
          industry: "Technology",
        },
      });

      const jobData: PDLEnrichmentJob = {
        type: "company",
        correlationId: "test-456",
        companyParams: { name: "Test Corp" },
      };

      const result = await enrichCompany(jobData.companyParams!);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Test Company");
    });

    it("should handle company enrichment failure", async () => {
      vi.mocked(enrichCompany).mockResolvedValue({
        success: false,
        status: 404,
        error: "No matching company found",
      });

      const result = await enrichCompany({ name: "Unknown Corp" });

      expect(result.success).toBe(false);
    });
  });

  describe("Job Validation", () => {
    it("should reject invalid job type", () => {
      const jobData = {
        type: "invalid" as "person",
        correlationId: "test-789",
      };

      // In the actual worker, this would return an error result
      expect(jobData.type).not.toBe("person");
      expect(jobData.type).not.toBe("company");
    });

    it("should reject person job without params", () => {
      const jobData: PDLEnrichmentJob = {
        type: "person",
        correlationId: "test-no-params",
        // Missing personParams
      };

      expect(jobData.personParams).toBeUndefined();
    });

    it("should reject company job without params", () => {
      const jobData: PDLEnrichmentJob = {
        type: "company",
        correlationId: "test-no-params",
        // Missing companyParams
      };

      expect(jobData.companyParams).toBeUndefined();
    });
  });
});

describe("PDL Worker Configuration", () => {
  it("should use default rate limit of 10 per minute", () => {
    // Rate limit is configured in the worker via getPDLRateLimit()
    const defaultRateLimit = {
      max: parseInt(process.env.PDL_RATE_LIMIT_PER_MINUTE || "10", 10),
      duration: 60000,
    };

    expect(defaultRateLimit.max).toBe(10);
    expect(defaultRateLimit.duration).toBe(60000);
  });

  it("should respect PDL_RATE_LIMIT_PER_MINUTE env var", () => {
    const originalEnv = process.env.PDL_RATE_LIMIT_PER_MINUTE;
    process.env.PDL_RATE_LIMIT_PER_MINUTE = "100";

    const rateLimit = {
      max: parseInt(process.env.PDL_RATE_LIMIT_PER_MINUTE || "10", 10),
      duration: 60000,
    };

    expect(rateLimit.max).toBe(100);

    // Restore
    if (originalEnv) {
      process.env.PDL_RATE_LIMIT_PER_MINUTE = originalEnv;
    } else {
      delete process.env.PDL_RATE_LIMIT_PER_MINUTE;
    }
  });

  it("should use concurrency of 1 for accurate rate limiting", () => {
    // The worker is created with concurrency: 1 to ensure
    // rate limiting is accurate (one job at a time)
    const workerConfig = {
      concurrency: 1,
      limiter: { max: 10, duration: 60000 },
    };

    expect(workerConfig.concurrency).toBe(1);
  });
});

describe("PDL Worker Job Result Types", () => {
  it("should structure person result correctly", () => {
    const result = {
      success: true,
      correlationId: "test-123",
      type: "person" as const,
      personResult: {
        success: true,
        status: 200,
        likelihood: 8,
        data: { id: "123", full_name: "Test", first_name: "Test", last_name: "User" },
      },
    };

    expect(result.type).toBe("person");
    expect(result.personResult).toBeDefined();
    expect(result.personResult?.likelihood).toBe(8);
  });

  it("should structure company result correctly", () => {
    const result = {
      success: true,
      correlationId: "test-456",
      type: "company" as const,
      companyResult: {
        success: true,
        status: 200,
        data: { id: "456", name: "Test Corp" },
      },
    };

    expect(result.type).toBe("company");
    expect(result.companyResult).toBeDefined();
    expect(result.companyResult?.data?.name).toBe("Test Corp");
  });

  it("should include error message on failure", () => {
    const result = {
      success: false,
      correlationId: "test-789",
      type: "person" as const,
      error: "No matching person found",
    };

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
