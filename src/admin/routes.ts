/**
 * Admin Routes Handler
 *
 * Serves the admin dashboard and API endpoints.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { parseJsonBody, sendJsonResponse, sendError } from "../webhooks/registry.js";
import type { NetworkingEventConfig, ContactStatus } from "../config/types.js";
import { getMediaStore } from "../storage/media-store.js";
import { subscribeToSwarmEvents, type SwarmEvent } from "../queue/client.js";
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
    // Serve React build (static assets and SPA fallback)
    if (method === "GET" && (pathname === "/admin" || pathname === "/admin/" || pathname.startsWith("/admin/assets/"))) {
      const basePath = __dirname;
      let filePath: string;

      if (pathname.startsWith("/admin/assets/")) {
        // Serve static assets
        filePath = path.join(basePath, pathname.replace("/admin/", ""));
      } else {
        // SPA fallback - serve index.html
        filePath = path.join(basePath, "index.html");
      }

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const contentTypes: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
        };
        const contentType = contentTypes[ext] || "application/octet-stream";

        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
        return;
      } catch (fileError) {
        // If asset not found, fallback to index.html for SPA routing
        if (pathname.startsWith("/admin/assets/")) {
          sendError(res, 404, "Asset not found");
          return;
        }
        const indexPath = path.join(basePath, "index.html");
        const html = fs.readFileSync(indexPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
    }

    // Serve media files
    if (pathname.startsWith("/admin/media/") && method === "GET") {
      await serveMediaFile(pathname, res);
      return;
    }

    // SSE endpoint for real-time swarm events
    if (pathname === "/admin/api/swarm/events" && method === "GET") {
      await handleSwarmEventsSSE(req, res);
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

  // GET /admin/api/swarm/states
  if (pathname === "/admin/api/swarm/states" && method === "GET") {
    const states = await api.getSwarmStates();
    sendJsonResponse(res, 200, states);
    return;
  }

  // GET /admin/api/swarm/handoffs
  if (pathname === "/admin/api/swarm/handoffs" && method === "GET") {
    const handoffs = await api.getHandoffs();
    sendJsonResponse(res, 200, handoffs);
    return;
  }

  // GET /admin/api/swarm/agents
  if (pathname === "/admin/api/swarm/agents" && method === "GET") {
    const stats = await api.getAgentStats();
    sendJsonResponse(res, 200, stats);
    return;
  }

  // GET /admin/api/swarm/conversation/:id
  const conversationMatch = pathname.match(/^\/admin\/api\/swarm\/conversation\/([^/]+)$/);
  if (conversationMatch && method === "GET") {
    const correlationId = decodeURIComponent(conversationMatch[1]);
    const data = await api.getSwarmConversation(correlationId);
    sendJsonResponse(res, 200, data);
    return;
  }

  // GET /admin/api/contacts/:id - Single contact detail
  const contactDetailMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)$/);
  if (contactDetailMatch && method === "GET") {
    const contactId = contactDetailMatch[1];
    const contact = await api.getContactById(contactId);
    if (!contact) {
      sendError(res, 404, "Contact not found");
      return;
    }
    sendJsonResponse(res, 200, contact);
    return;
  }

  // GET /admin/api/contacts/:id/enrichment - PDL enrichment data
  const enrichmentMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)\/enrichment$/);
  if (enrichmentMatch && method === "GET") {
    const contactId = enrichmentMatch[1];
    const enrichment = await api.getContactEnrichment(contactId);
    sendJsonResponse(res, 200, enrichment);
    return;
  }

  // GET /admin/api/contacts/:id/luma - Luma guest and events
  const lumaMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)\/luma$/);
  if (lumaMatch && method === "GET") {
    const contactId = lumaMatch[1];
    const luma = await api.getContactLumaAssociations(contactId);
    sendJsonResponse(res, 200, luma);
    return;
  }

  // GET /admin/api/contacts/:id/media - Media files
  const mediaMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)\/media$/);
  if (mediaMatch && method === "GET") {
    const contactId = mediaMatch[1];
    const media = await api.getContactMedia(contactId);
    sendJsonResponse(res, 200, media);
    return;
  }

  // GET /admin/api/contacts/:id/activities - Agent activities
  const activitiesMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)\/activities$/);
  if (activitiesMatch && method === "GET") {
    const contactId = activitiesMatch[1];
    const activities = await api.getContactActivities(contactId);
    sendJsonResponse(res, 200, activities);
    return;
  }

  // GET /admin/api/contacts/:id/messages - Messages for contact
  const messagesMatch = pathname.match(/^\/admin\/api\/contacts\/([^/]+)\/messages$/);
  if (messagesMatch && method === "GET") {
    const contactId = messagesMatch[1];
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const messages = await api.getMessagesForContact(contactId, limit);
    sendJsonResponse(res, 200, messages);
    return;
  }

  // GET /admin/api/settings/greeting-video
  if (pathname === "/admin/api/settings/greeting-video" && method === "GET") {
    const video = await api.getGreetingVideo();
    sendJsonResponse(res, 200, video);
    return;
  }

  // POST /admin/api/settings/greeting-video (multipart upload)
  if (pathname === "/admin/api/settings/greeting-video" && method === "POST") {
    try {
      const { data, mimeType, filename } = await parseMultipartVideo(req);
      if (!data) {
        sendError(res, 400, "No video file provided");
        return;
      }

      const result = await api.storeGreetingVideo(data, mimeType, filename);
      sendJsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : "Upload failed");
    }
    return;
  }

  // DELETE /admin/api/settings/greeting-video
  if (pathname === "/admin/api/settings/greeting-video" && method === "DELETE") {
    const result = await api.deleteGreetingVideo();
    sendJsonResponse(res, result.success ? 200 : 400, result);
    return;
  }

  // 404 for unknown API endpoints
  sendError(res, 404, "API endpoint not found");
}

/**
 * Parse multipart form data for video upload
 */
async function parseMultipartVideo(
  req: IncomingMessage
): Promise<{ data: Buffer | null; mimeType: string; filename?: string }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);

    if (!boundaryMatch) {
      reject(new Error("Invalid content-type: no boundary"));
      return;
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks);
        const boundaryBuffer = Buffer.from(`--${boundary}`);

        // Find the video part
        let start = body.indexOf(boundaryBuffer);
        if (start === -1) {
          resolve({ data: null, mimeType: "video/mp4" });
          return;
        }

        // Skip to first part after boundary
        start = body.indexOf(Buffer.from("\r\n\r\n"), start);
        if (start === -1) {
          resolve({ data: null, mimeType: "video/mp4" });
          return;
        }

        // Extract headers from the part
        const headerEnd = start;
        const headerStart = body.lastIndexOf(boundaryBuffer, headerEnd) + boundaryBuffer.length;
        const headerSection = body.slice(headerStart, headerEnd).toString("utf-8");

        // Parse Content-Disposition for filename
        let filename: string | undefined;
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }

        // Parse Content-Type
        let mimeType = "video/mp4";
        const contentTypeMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
        if (contentTypeMatch) {
          mimeType = contentTypeMatch[1].trim();
        }

        // Skip \r\n\r\n to get to content
        start += 4;

        // Find end boundary
        const endBoundary = Buffer.from(`\r\n--${boundary}`);
        let end = body.indexOf(endBoundary, start);
        if (end === -1) {
          end = body.length;
        }

        const data = body.slice(start, end);
        resolve({ data, mimeType, filename });
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

/**
 * Handle Server-Sent Events for real-time swarm updates
 */
async function handleSwarmEventsSSE(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  // Keep-alive interval (every 30 seconds)
  const keepAlive = setInterval(() => {
    res.write(`: keepalive\n\n`);
  }, 30000);

  // Subscribe to swarm events
  const unsubscribe = await subscribeToSwarmEvents((event: SwarmEvent) => {
    try {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  });

  // Also send periodic state updates (every 2 seconds for smooth topology)
  const stateInterval = setInterval(async () => {
    try {
      const [activities, states] = await Promise.all([
        api.getActivities(20),
        api.getSwarmStates(),
      ]);

      res.write(`event: state:sync\ndata: ${JSON.stringify({
        type: "state:sync",
        timestamp: new Date().toISOString(),
        data: { activities, states },
      })}\n\n`);
    } catch {
      // Ignore errors
    }
  }, 2000);

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    clearInterval(stateInterval);
    unsubscribe();
  });
}

/**
 * Serve media files from storage
 */
async function serveMediaFile(pathname: string, res: ServerResponse): Promise<void> {
  // Extract storage key from path: /admin/media/video/SYSTEM/xxx.mp4 -> video/SYSTEM/xxx.mp4
  const storageKey = pathname.replace("/admin/media/", "");

  if (!storageKey) {
    sendError(res, 400, "Invalid media path");
    return;
  }

  try {
    const mediaStore = getMediaStore();
    const data = await mediaStore.get(storageKey);

    if (!data) {
      sendError(res, 404, "Media not found");
      return;
    }

    // Get metadata for content-type
    const metadata = await mediaStore.getMetadata(storageKey);
    const contentType = metadata?.mimeType || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "max-age=3600",
    });
    res.end(data);
  } catch (error) {
    console.error("[admin] Error serving media:", error);
    sendError(res, 500, "Failed to serve media");
  }
}
