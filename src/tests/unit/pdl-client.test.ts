/**
 * PDL Client Unit Tests
 *
 * Tests the People Data Labs client including retry logic and error handling.
 * Uses mocking to avoid actual API calls.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import {
  enrichPerson,
  enrichCompany,
  enrichContact,
  enrichByEmail,
  enrichByPhone,
  enrichByLinkedIn,
  enrichByNameAndCompany,
  checkApiKey,
} from "../../integrations/pdl/client.js";

describe("PDL Client", () => {
  const originalEnv = process.env.PDL_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PDL_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.PDL_API_KEY = originalEnv;
    } else {
      delete process.env.PDL_API_KEY;
    }
  });

  describe("enrichPerson", () => {
    it("should return error when API key not configured", async () => {
      delete process.env.PDL_API_KEY;

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toContain("not configured");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should return error for insufficient parameters", async () => {
      const result = await enrichPerson({});

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toContain("Insufficient parameters");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should accept email as identity parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          likelihood: 8,
          matched: ["email"],
          data: { full_name: "Test User", email: "test@example.com" },
        }),
        headers: new Headers(),
      });

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.likelihood).toBe(8);
      expect(result.data?.full_name).toBe("Test User");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should accept phone as identity parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          likelihood: 7,
          data: { full_name: "Phone User" },
        }),
        headers: new Headers(),
      });

      const result = await enrichPerson({ phone: "+15551234567" });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should accept LinkedIn URL as identity parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          likelihood: 9,
          data: { full_name: "LinkedIn User" },
        }),
        headers: new Headers(),
      });

      const result = await enrichPerson({ profile: "https://linkedin.com/in/testuser" });

      expect(result.success).toBe(true);
    });

    it("should accept name + company as context parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          likelihood: 6,
          data: { full_name: "Named User" },
        }),
        headers: new Headers(),
      });

      const result = await enrichPerson({
        first_name: "John",
        last_name: "Doe",
        company: "Acme Inc",
      });

      expect(result.success).toBe(true);
    });

    it("should handle 404 (no match) gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: 404, error: { message: "Not found" } }),
        headers: new Headers(),
      });

      const result = await enrichPerson({ email: "unknown@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toContain("No matching person");
    });

    it("should retry on 429 rate limit", async () => {
      // First call returns 429, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ error: { message: "Rate limited" } }),
          headers: new Headers({ "Retry-After": "1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            likelihood: 8,
            data: { full_name: "Retry User" },
          }),
          headers: new Headers(),
        });

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on 429", async () => {
      // All calls return 429
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Rate limited" } }),
        headers: new Headers({ "Retry-After": "1" }),
      });

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain("Rate limit exceeded");
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 30000);

    it("should retry on network errors", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            likelihood: 7,
            data: { full_name: "Network User" },
          }),
          headers: new Headers(),
        });

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Persistent network error"));

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("network error");
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 30000);

    it("should handle non-200/404 errors without retry", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Forbidden" } }),
        headers: new Headers(),
      });

      const result = await enrichPerson({ email: "test@example.com" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(403);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries for 403
    });

    it("should use default options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          data: { full_name: "Default User" },
        }),
        headers: new Headers(),
      });

      await enrichPerson({ email: "test@example.com" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("titlecase=true");
      expect(callUrl).toContain("min_likelihood=5");
      expect(callUrl).toContain("include_if_matched=true");
    });
  });

  describe("enrichCompany", () => {
    it("should return error when API key not configured", async () => {
      delete process.env.PDL_API_KEY;

      const result = await enrichCompany({ name: "Acme" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
    });

    it("should return error for missing parameters", async () => {
      const result = await enrichCompany({});

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toContain("lookup parameter required");
    });

    it("should enrich company by name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          data: { name: "Acme Inc", industry: "Technology" },
        }),
        headers: new Headers(),
      });

      const result = await enrichCompany({ name: "Acme" });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Acme Inc");
    });

    it("should enrich company by website", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          data: { name: "Example Corp", website: "example.com" },
        }),
        headers: new Headers(),
      });

      const result = await enrichCompany({ website: "example.com" });

      expect(result.success).toBe(true);
    });

    it("should handle 404 gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: 404 }),
        headers: new Headers(),
      });

      const result = await enrichCompany({ name: "Unknown Company" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should retry on 429", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({}),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: { name: "Retry Corp" },
          }),
          headers: new Headers(),
        });

      const result = await enrichCompany({ name: "Test" });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should retry on network errors", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: { name: "Recovered Corp" },
          }),
          headers: new Headers(),
        });

      const result = await enrichCompany({ name: "Test" });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries on network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Persistent network error"));

      const result = await enrichCompany({ name: "Test" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("network error");
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 30000);

    it("should fail after max retries on 429", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
        headers: new Headers(),
      });

      const result = await enrichCompany({ name: "Test" });

      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain("Rate limit exceeded");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    }, 30000);
  });

  describe("Convenience Functions", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          likelihood: 8,
          data: { full_name: "Test User" },
        }),
        headers: new Headers(),
      });
    });

    it("enrichByEmail should call enrichPerson with email", async () => {
      const result = await enrichByEmail("test@example.com");

      expect(result.success).toBe(true);
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("email=test%40example.com");
    });

    it("enrichByPhone should normalize phone number", async () => {
      await enrichByPhone("5551234567");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("phone=%2B5551234567");
    });

    it("enrichByPhone should preserve + prefix", async () => {
      await enrichByPhone("+15551234567");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("phone=%2B15551234567");
    });

    it("enrichByLinkedIn should call enrichPerson with profile", async () => {
      await enrichByLinkedIn("https://linkedin.com/in/testuser");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("profile=");
    });

    it("enrichByNameAndCompany should call enrichPerson with name fields", async () => {
      await enrichByNameAndCompany("John", "Doe", "Acme Inc");

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("first_name=John");
      expect(callUrl).toContain("last_name=Doe");
      expect(callUrl).toContain("company=Acme");
    });
  });

  describe("enrichContact", () => {
    it("should try LinkedIn first when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          data: { full_name: "LinkedIn User" },
        }),
        headers: new Headers(),
      });

      const result = await enrichContact({
        linkedinUrl: "https://linkedin.com/in/test",
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("profile=");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fall back to email when LinkedIn fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ status: 404 }),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: { full_name: "Email User" },
          }),
          headers: new Headers(),
        });

      const result = await enrichContact({
        linkedinUrl: "https://linkedin.com/in/unknown",
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fall back to phone when email fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ status: 404 }),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: { full_name: "Phone User" },
          }),
          headers: new Headers(),
        });

      const result = await enrichContact({
        email: "unknown@example.com",
        phone: "+15551234567",
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fall back to name+company as last resort", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ status: 404 }),
          headers: new Headers(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: { full_name: "Named User" },
          }),
          headers: new Headers(),
        });

      const result = await enrichContact({
        email: "unknown@example.com",
        firstName: "John",
        lastName: "Doe",
        company: "Acme",
      });

      expect(result.success).toBe(true);
    });

    it("should return 404 when all methods fail", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ status: 404 }),
        headers: new Headers(),
      });

      const result = await enrichContact({
        email: "unknown@example.com",
        phone: "+10000000000",
        firstName: "Unknown",
        lastName: "Person",
        company: "Nowhere Inc",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });
  });

  describe("checkApiKey", () => {
    it("should return invalid when no API key", async () => {
      delete process.env.PDL_API_KEY;

      const result = await checkApiKey();

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not set");
    });

    it("should return valid on 404 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await checkApiKey();

      expect(result.valid).toBe(true);
    });

    it("should return invalid on 401 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 401,
        ok: false,
      });

      const result = await checkApiKey();

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("should return invalid on 403 response", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 403,
        ok: false,
      });

      const result = await checkApiKey();

      expect(result.valid).toBe(false);
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkApiKey();

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
