/**
 * Admin Routes Handler
 *
 * Serves the admin dashboard and API endpoints.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { parseJsonBody, sendJsonResponse, sendError } from "../webhooks/registry.js";
import type { NetworkingEventConfig, ContactStatus } from "../config/types.js";
import * as api from "./api.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Handle admin requests
 */
export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _config: NetworkingEventConfig
): Promise<void> {
  const url = req.url ?? "/admin";
  const method = req.method ?? "GET";

  // Parse URL and query params
  const urlObj = new URL(url, "http://localhost");
  const pathname = urlObj.pathname;

  try {
    // Serve dashboard HTML
    if ((pathname === "/admin" || pathname === "/admin/") && method === "GET") {
      const htmlPath = path.join(__dirname, "dashboard.html");
      const html = fs.readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // API endpoints
    if (pathname.startsWith("/admin/api/")) {
      await handleApiRequest(pathname, method, req, res, urlObj.searchParams);
      return;
    }

    // 404 for unknown admin paths
    sendError(res, 404, "Not found");
  } catch (error) {
    console.error("[admin] Error handling request:", error);
    sendError(res, 500, error instanceof Error ? error.message : "Internal error");
  }
}

/**
 * Handle API requests
 */
async function handleApiRequest(
  pathname: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  params: URLSearchParams
): Promise<void> {
  // GET /admin/api/stats
  if (pathname === "/admin/api/stats" && method === "GET") {
    const stats = await api.getStats();
    sendJsonResponse(res, 200, stats);
    return;
  }

  // GET /admin/api/contacts
  if (pathname === "/admin/api/contacts" && method === "GET") {
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const status = params.get("status") as ContactStatus | null;
    const contacts = await api.getContacts(limit, status ?? undefined);
    sendJsonResponse(res, 200, contacts);
    return;
  }

  // GET /admin/api/activities
  if (pathname === "/admin/api/activities" && method === "GET") {
    const limit = parseInt(params.get("limit") ?? "20", 10);
    const agentType = params.get("agentType") ?? undefined;
    const activities = await api.getActivities(limit, agentType);
    sendJsonResponse(res, 200, activities);
    return;
  }

  // GET /admin/api/messages
  if (pathname === "/admin/api/messages" && method === "GET") {
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const contactId = params.get("contactId") ?? undefined;
    const phone = params.get("phone") ?? undefined;

    let messages;
    if (phone) {
      messages = await api.getMessagesByPhone(phone, limit);
    } else if (contactId) {
      messages = await api.getMessagesForContact(contactId, limit);
    } else {
      messages = await api.getMessages(limit);
    }
    sendJsonResponse(res, 200, messages);
    return;
  }

  // GET /admin/api/queues
  if (pathname === "/admin/api/queues" && method === "GET") {
    const queues = await api.getQueues();
    sendJsonResponse(res, 200, queues);
    return;
  }

  // GET /admin/api/health
  if (pathname === "/admin/api/health" && method === "GET") {
    const health = await api.getHealth();
    sendJsonResponse(res, 200, health);
    return;
  }

  // POST /admin/api/send-voice/:id
  const voiceMatch = pathname.match(/^\/admin\/api\/send-voice\/([^/]+)$/);
  if (voiceMatch && method === "POST") {
    const contactId = voiceMatch[1];
    const result = await api.sendVoice(contactId);
    sendJsonResponse(res, result.success ? 200 : 400, result);
    return;
  }

  // POST /admin/api/send-video/:id
  const videoMatch = pathname.match(/^\/admin\/api\/send-video\/([^/]+)$/);
  if (videoMatch && method === "POST") {
    const contactId = videoMatch[1];
    const result = await api.sendVideo(contactId);
    sendJsonResponse(res, result.success ? 200 : 400, result);
    return;
  }

  // 404 for unknown API endpoints
  sendError(res, 404, "API endpoint not found");
}
