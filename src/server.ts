/**
 * NextHello Server
 *
 * HTTP server for webhooks and health checks.
 * This is the main entry point when running in Docker.
 */

import "dotenv/config";
import http from "http";
import { getCalendlyWebhookPath } from "./webhooks/calendly.js";
import { getHeyGenWebhookPath } from "./webhooks/heygen.js";
import { getCalendlyOAuthPath } from "./webhooks/calendly-oauth.js";
import { sendJsonResponse, sendError, matchRoute, getWebhookRoutes } from "./webhooks/registry.js";
import { safeParseConfig } from "./config/schema.js";
import type { NetworkingEventConfig } from "./config/types.js";
import { getMetrics, getMetricsContentType, recordHttpRequest, startTimer } from "./observability/metrics.js";
import fs from "fs";
import path from "path";
import { createVideoWorker } from "./queue/workers/video.worker.js";
import { createAgentTaskWorker } from "./queue/workers/agent-task.worker.js";
import type { Worker } from "bullmq";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Track workers for graceful shutdown
const workers: Worker[] = [];
const HOST = process.env.HOST ?? "0.0.0.0";

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Load configuration
 */
function loadConfig(): NetworkingEventConfig {
  // Try to load from file
  const configPaths = [
    "./nexthello.config.json",
    "/app/nexthello.config.json",
    path.join(process.env.HOME ?? "", ".nexthello/config.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(content);
        const result = safeParseConfig(parsed);
        if (result) {
          log(`Loaded config from ${configPath}`);
          return result;
        }
      }
    } catch {
      // Continue to next path
    }
  }

  // Return minimal config from env vars
  log("Using config from environment variables");
  return {
    enabled: true,
    eventName: process.env.NEXTHELLO_EVENT_NAME ?? "Event",
    ownerName: process.env.NEXTHELLO_OWNER_NAME ?? "Team",
    requiredFields: ["email", "company_name", "job_title"],
    supabase: {
      tableName: "contacts",
    },
    calendly: {
      schedulingLink: process.env.NEXTHELLO_CALENDLY_LINK,
    },
  };
}

// Load config at startup
const config = loadConfig();

/**
 * Request handler
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const endTimer = startTimer();

  // Normalize path for metrics (remove query string, normalize ids)
  const pathForMetrics = url.split("?")[0].replace(/\/[0-9a-f-]{36}/g, "/:id");

  log(`${method} ${url}`);

  try {
    // Prometheus metrics endpoint
    if (url === "/metrics") {
      const metrics = await getMetrics();
      res.writeHead(200, { "Content-Type": getMetricsContentType() });
      res.end(metrics);
      recordHttpRequest(method, pathForMetrics, 200, endTimer());
      return;
    }

    // Health check
    if (url === "/health" || url === "/healthz") {
      sendJsonResponse(res, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      });
      recordHttpRequest(method, pathForMetrics, 200, endTimer());
      return;
    }

    // Ready check
    if (url === "/ready") {
      sendJsonResponse(res, 200, { ready: true });
      recordHttpRequest(method, pathForMetrics, 200, endTimer());
      return;
    }

    // Root
    if (url === "/" && method === "GET") {
      sendJsonResponse(res, 200, {
        name: "NextHello",
        description: "AI-powered networking assistant",
        endpoints: {
          health: "/health",
          metrics: "/metrics",
          admin: "/admin",
          webhooks: {
            calendly: getCalendlyWebhookPath(),
            heygen: getHeyGenWebhookPath(),
          },
        },
      });
      recordHttpRequest(method, pathForMetrics, 200, endTimer());
      return;
    }

    // Try to match webhook routes
    const route = matchRoute(url);
    if (route) {
      await route.handler(req, res, config);
      recordHttpRequest(method, pathForMetrics, res.statusCode || 200, endTimer());
      return;
    }

    // Serve mock video for HEYGEN_MOCK_MODE
    if (url === "/mock-video.mp4" && method === "GET") {
      const mockVideoPath = process.env.HEYGEN_MOCK_VIDEO_PATH;
      if (mockVideoPath && fs.existsSync(mockVideoPath)) {
        const stat = fs.statSync(mockVideoPath);
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": stat.size,
        });
        const readStream = fs.createReadStream(mockVideoPath);
        readStream.pipe(res);
        recordHttpRequest(method, pathForMetrics, 200, endTimer());
        return;
      }
      sendError(res, 404, "Mock video not configured");
      recordHttpRequest(method, pathForMetrics, 404, endTimer());
      return;
    }

    // Admin dashboard
    if (url.startsWith("/admin")) {
      const { handleAdminRequest } = await import("./admin/routes.js");
      await handleAdminRequest(req, res, config);
      recordHttpRequest(method, pathForMetrics, res.statusCode || 200, endTimer());
      return;
    }

    // Test API for conversation simulation (only in development)
    if (url === "/api/test/process" && method === "POST") {
      const { getOrchestrator } = await import("./swarm/orchestrator.js");
      const { findContactByPhone } = await import("./contacts/index.js");

      // Read body
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });

      const { phoneNumber, message, channel = "whatsapp" } = JSON.parse(body);

      if (!phoneNumber || !message) {
        sendError(res, 400, "phoneNumber and message required");
        recordHttpRequest(method, pathForMetrics, 400, endTimer());
        return;
      }

      const contact = await findContactByPhone(phoneNumber, config.supabase);
      const orchestrator = getOrchestrator(config);
      const result = await orchestrator.processMessage(
        phoneNumber,
        message,
        channel,
        contact ?? undefined
      );

      sendJsonResponse(res, 200, result);
      recordHttpRequest(method, pathForMetrics, 200, endTimer());
      return;
    }

    // 404
    sendError(res, 404, "Not found");
    recordHttpRequest(method, pathForMetrics, 404, endTimer());
  } catch (error) {
    log(`Error handling request: ${error}`);
    if (!res.headersSent) {
      sendError(res, 500, "Internal server error");
    }
    recordHttpRequest(method, pathForMetrics, 500, endTimer());
  }
}

/**
 * Start the server
 */
function startServer(): void {
  // Import webhook modules to register routes
  import("./webhooks/calendly.js").catch(() => {});
  import("./webhooks/heygen.js").catch(() => {});
  import("./webhooks/calendly-oauth.js").catch(() => {});

  // Start video worker
  const videoWorker = createVideoWorker(config);
  if (videoWorker) {
    workers.push(videoWorker);
    log("Video worker started" + (process.env.HEYGEN_MOCK_MODE ? " (MOCK MODE)" : ""));
  } else {
    log("Video worker not started (Redis unavailable)");
  }

  // Start agent-task worker for parallel execution
  const agentTaskWorker = createAgentTaskWorker(config);
  if (agentTaskWorker) {
    workers.push(agentTaskWorker);
    log("Agent task worker started");
  } else {
    log("Agent task worker not started (Redis unavailable)");
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      log(`Unhandled error: ${error}`);
      if (!res.headersSent) {
        sendError(res, 500, "Internal server error");
      }
    });
  });

  server.listen(PORT, HOST, () => {
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log("  NextHello Server");
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log(`  Listening on http://${HOST}:${PORT}`);
    log("");
    log("  Endpoints:");
    log(`    Health:   http://${HOST}:${PORT}/health`);
    log(`    Metrics:  http://${HOST}:${PORT}/metrics`);
    log(`    Admin:    http://${HOST}:${PORT}/admin`);
    log(`    Calendly: http://${HOST}:${PORT}${getCalendlyWebhookPath()}`);
    log(`    HeyGen:   http://${HOST}:${PORT}${getHeyGenWebhookPath()}`);
    log(`    Calendly OAuth: http://${HOST}:${PORT}${getCalendlyOAuthPath()}/auth`);
    log("");
    log("  Config:");
    log(`    Event: ${config.eventName}`);
    log(`    Owner: ${config.ownerName}`);
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Log registered routes
    const routes = getWebhookRoutes();
    if (routes.length > 0) {
      log(`  Registered ${routes.length} webhook routes`);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, shutting down...`);

    // Close workers first
    if (workers.length > 0) {
      log(`Closing ${workers.length} worker(s)...`);
      await Promise.all(workers.map((w) => w.close()));
      log("Workers closed");
    }

    server.close(() => {
      log("Server closed");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      log("Forcing exit");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Run
startServer();
