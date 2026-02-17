/**
 * Admin Routes Unit Tests
 *
 * Tests the admin routes handler for serving the dashboard and API.
 *
 * Run with: npm run test:unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";

// Mock dependencies
vi.mock("fs");
vi.mock("path");
vi.mock("../../admin/api.js", () => ({
  getStats: vi.fn().mockResolvedValue({ total: 100, byStatus: {}, byQualification: {} }),
  getContacts: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  getMessages: vi.fn().mockResolvedValue([]),
  getMessagesByPhone: vi.fn().mockResolvedValue([]),
  getMessagesForContact: vi.fn().mockResolvedValue([]),
  getQueues: vi.fn().mockResolvedValue([]),
  getHealth: vi.fn().mockResolvedValue({ redis: { connected: true }, postgres: { healthy: true } }),
  sendVoice: vi.fn().mockResolvedValue({ success: true, jobId: "job-1" }),
  sendVideo: vi.fn().mockResolvedValue({ success: true, jobId: "job-2" }),
  getSwarmStates: vi.fn().mockResolvedValue([]),
  getHandoffs: vi.fn().mockResolvedValue([]),
  getAgentStats: vi.fn().mockResolvedValue([]),
  getSwarmConversation: vi.fn().mockResolvedValue({ state: null, activities: [], messages: [] }),
}));

vi.mock("../../webhooks/registry.js", () => ({
  parseJsonBody: vi.fn().mockResolvedValue({}),
  sendJsonResponse: vi.fn(),
  sendError: vi.fn(),
}));

import { handleAdminRequest } from "../../admin/routes.js";
import * as api from "../../admin/api.js";
import { sendJsonResponse, sendError } from "../../webhooks/registry.js";

function createMockRequest(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: {},
  } as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
  } as unknown as ServerResponse;
}

const mockConfig = {
  enabled: true,
  eventName: "Test Event",
  ownerName: "Test Owner",
  requiredFields: [],
};

describe("Admin Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(path.join).mockImplementation((...args) => args.join("/"));
    vi.mocked(path.extname).mockImplementation((p) => {
      const match = p.match(/\.[^.]+$/);
      return match ? match[0] : "";
    });
  });

  describe("Dashboard Serving", () => {
    it("should serve index.html for /admin", async () => {
      const mockHtml = "<html><body>Admin</body></html>";
      vi.mocked(fs.readFileSync).mockReturnValue(mockHtml);

      const req = createMockRequest("GET", "/admin");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8" });
      expect(res.end).toHaveBeenCalledWith(mockHtml);
    });

    it("should serve index.html for /admin/", async () => {
      const mockHtml = "<html><body>Admin</body></html>";
      vi.mocked(fs.readFileSync).mockReturnValue(mockHtml);

      const req = createMockRequest("GET", "/admin/");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8" });
    });

    it("should serve JavaScript assets", async () => {
      const mockJs = "console.log('test')";
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(mockJs));

      const req = createMockRequest("GET", "/admin/assets/index-abc123.js");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/javascript" });
    });

    it("should serve CSS assets", async () => {
      const mockCss = "body { color: red; }";
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(mockCss));

      const req = createMockRequest("GET", "/admin/assets/index-abc123.css");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/css" });
    });

    it("should handle missing asset with 404", async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      const req = createMockRequest("GET", "/admin/assets/nonexistent.js");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(sendError).toHaveBeenCalledWith(res, 404, "Asset not found");
    });
  });

  describe("API Endpoints", () => {
    it("should handle GET /admin/api/stats", async () => {
      const mockStats = { total: 100, byStatus: {}, byQualification: {} };
      vi.mocked(api.getStats).mockResolvedValue(mockStats);

      const req = createMockRequest("GET", "/admin/api/stats");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getStats).toHaveBeenCalled();
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockStats);
    });

    it("should handle GET /admin/api/contacts with limit", async () => {
      const mockContacts = [{ id: "1" }];
      vi.mocked(api.getContacts).mockResolvedValue(mockContacts as any);

      const req = createMockRequest("GET", "/admin/api/contacts?limit=10");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getContacts).toHaveBeenCalledWith(10, undefined);
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockContacts);
    });

    it("should handle GET /admin/api/contacts with status filter", async () => {
      vi.mocked(api.getContacts).mockResolvedValue([]);

      const req = createMockRequest("GET", "/admin/api/contacts?limit=10&status=qualified");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getContacts).toHaveBeenCalledWith(10, "qualified");
    });

    it("should handle GET /admin/api/activities", async () => {
      const mockActivities = [{ id: "1" }];
      vi.mocked(api.getActivities).mockResolvedValue(mockActivities as any);

      const req = createMockRequest("GET", "/admin/api/activities?limit=20");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getActivities).toHaveBeenCalledWith(20, undefined);
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockActivities);
    });

    it("should handle GET /admin/api/activities with agentType filter", async () => {
      vi.mocked(api.getActivities).mockResolvedValue([]);

      const req = createMockRequest("GET", "/admin/api/activities?limit=20&agentType=orchestrator");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getActivities).toHaveBeenCalledWith(20, "orchestrator");
    });

    it("should handle GET /admin/api/messages", async () => {
      const mockMessages = [{ id: "1" }];
      vi.mocked(api.getMessages).mockResolvedValue(mockMessages as any);

      const req = createMockRequest("GET", "/admin/api/messages?limit=50");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getMessages).toHaveBeenCalledWith(50);
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockMessages);
    });

    it("should handle GET /admin/api/messages with phone filter", async () => {
      vi.mocked(api.getMessagesByPhone).mockResolvedValue([]);

      const req = createMockRequest("GET", "/admin/api/messages?limit=50&phone=%2B1555123456");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getMessagesByPhone).toHaveBeenCalledWith("+1555123456", 50);
    });

    it("should handle GET /admin/api/queues", async () => {
      const mockQueues = [{ name: "incoming-messages", waiting: 5 }];
      vi.mocked(api.getQueues).mockResolvedValue(mockQueues as any);

      const req = createMockRequest("GET", "/admin/api/queues");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getQueues).toHaveBeenCalled();
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockQueues);
    });

    it("should handle GET /admin/api/health", async () => {
      const mockHealth = { redis: { connected: true }, postgres: { healthy: true } };
      vi.mocked(api.getHealth).mockResolvedValue(mockHealth as any);

      const req = createMockRequest("GET", "/admin/api/health");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getHealth).toHaveBeenCalled();
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockHealth);
    });

    it("should handle POST /admin/api/send-voice/:id", async () => {
      const mockResult = { success: true, jobId: "job-1" };
      vi.mocked(api.sendVoice).mockResolvedValue(mockResult);

      const req = createMockRequest("POST", "/admin/api/send-voice/contact-123");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.sendVoice).toHaveBeenCalledWith("contact-123");
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockResult);
    });

    it("should handle POST /admin/api/send-video/:id", async () => {
      const mockResult = { success: true, jobId: "job-2" };
      vi.mocked(api.sendVideo).mockResolvedValue(mockResult);

      const req = createMockRequest("POST", "/admin/api/send-video/contact-456");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.sendVideo).toHaveBeenCalledWith("contact-456");
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockResult);
    });

    it("should handle GET /admin/api/swarm/states", async () => {
      const mockStates = [{ correlationId: "corr-1" }];
      vi.mocked(api.getSwarmStates).mockResolvedValue(mockStates as any);

      const req = createMockRequest("GET", "/admin/api/swarm/states");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getSwarmStates).toHaveBeenCalled();
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockStates);
    });

    it("should handle GET /admin/api/swarm/agents", async () => {
      const mockStats = [{ agentType: "orchestrator", executions: 100 }];
      vi.mocked(api.getAgentStats).mockResolvedValue(mockStats as any);

      const req = createMockRequest("GET", "/admin/api/swarm/agents");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(api.getAgentStats).toHaveBeenCalled();
      expect(sendJsonResponse).toHaveBeenCalledWith(res, 200, mockStats);
    });

    it("should return 404 for unknown API endpoints", async () => {
      const req = createMockRequest("GET", "/admin/api/unknown");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(sendError).toHaveBeenCalledWith(res, 404, "API endpoint not found");
    });

    it("should return 404 for unknown admin paths", async () => {
      const req = createMockRequest("GET", "/admin/unknown");
      const res = createMockResponse();

      // Mock file read to throw to simulate missing file
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      await handleAdminRequest(req, res, mockConfig as any);

      // Should try to serve index.html, fail, then return 404
      expect(sendError).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      vi.mocked(api.getStats).mockRejectedValue(new Error("Database error"));

      const req = createMockRequest("GET", "/admin/api/stats");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(sendError).toHaveBeenCalledWith(res, 500, "Database error");
    });

    it("should return 400 for failed actions", async () => {
      vi.mocked(api.sendVoice).mockResolvedValue({ success: false, error: "Contact not found" });

      const req = createMockRequest("POST", "/admin/api/send-voice/invalid");
      const res = createMockResponse();

      await handleAdminRequest(req, res, mockConfig as any);

      expect(sendJsonResponse).toHaveBeenCalledWith(res, 400, { success: false, error: "Contact not found" });
    });
  });
});
