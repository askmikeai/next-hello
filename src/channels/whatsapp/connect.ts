#!/usr/bin/env node
/**
 * WhatsApp Connection Script
 *
 * Run this to connect your WhatsApp account.
 * It will display a QR code to scan with your phone.
 *
 * Usage:
 *   npx tsx src/channels/whatsapp/connect.ts
 *   # or after build:
 *   node dist/src/channels/whatsapp/connect.js
 */

import { createWhatsAppClient } from "./client.js";
import { safeParseConfig } from "../../config/schema.js";
import type { NetworkingEventConfig } from "../../config/types.js";
import { getMetrics, getMetricsContentType } from "../../observability/metrics.js";
import { createServer } from "http";
import fs from "fs";
import path from "path";

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Load configuration
 */
function loadConfig(): NetworkingEventConfig {
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
      // Continue
    }
  }

  log("Using default config from environment");
  return {
    enabled: true,
    eventName: process.env.NEXTHELLO_EVENT_NAME ?? "Event",
    ownerName: process.env.NEXTHELLO_OWNER_NAME ?? "Team",
    requiredFields: ["email", "company_name", "job_title"],
    supabase: {
      tableName: process.env.SUPABASE_TABLE ?? "contacts",
    },
    calendly: {
      schedulingLink: process.env.NEXTHELLO_CALENDLY_LINK,
    },
  };
}

async function main(): Promise<void> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  NextHello - WhatsApp Connection");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("  This will connect your WhatsApp account to NextHello.");
  console.log("  A QR code will appear below - scan it with your phone:");
  console.log("");
  console.log("  1. Open WhatsApp on your phone");
  console.log("  2. Go to Settings > Linked Devices");
  console.log("  3. Tap 'Link a Device'");
  console.log("  4. Scan the QR code below");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  const config = loadConfig();

  log(`Event: ${config.eventName}`);
  log(`Owner: ${config.ownerName}`);
  console.log("");

  // Start metrics server with test API
  const metricsPort = parseInt(process.env.METRICS_PORT ?? "3001", 10);
  const metricsServer = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (url === "/metrics") {
      const metrics = await getMetrics();
      res.writeHead(200, { "Content-Type": getMetricsContentType() });
      res.end(metrics);
    } else if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "whatsapp" }));
    } else if (url.startsWith("/api/test/clear/") && method === "DELETE") {
      // Clear test data for a phone number
      try {
        const phoneNumber = url.split("/api/test/clear/")[1];
        if (!phoneNumber) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Phone number required" }));
          return;
        }

        const { getMessageStore } = await import("../../history/message-store.js");
        const messageStore = getMessageStore();
        await messageStore.clearMessages(phoneNumber);

        // Also clear from Redis (scheduling context, voice mode)
        const { getRedisConnection } = await import("../../queue/client.js");
        const redis = getRedisConnection();
        if (redis) {
          await redis.del(`scheduling:${phoneNumber}`);
          await redis.del(`voice_mode:${phoneNumber}`);
          await redis.del(`swarm:state:${phoneNumber}`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, cleared: phoneNumber }));
      } catch (error) {
        log(`Clear test data error: ${error}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    } else if (url === "/api/test/process" && method === "POST") {
      // Test API for conversation simulation
      try {
        const { getOrchestrator } = await import("../../swarm/orchestrator.js");
        const { findContactByPhone } = await import("../../contacts/index.js");

        // Read body
        const body = await new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk: Buffer) => (data += chunk.toString()));
          req.on("end", () => resolve(data));
        });

        const { phoneNumber, message, channel = "whatsapp" } = JSON.parse(body);

        if (!phoneNumber || !message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "phoneNumber and message required" }));
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

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        log(`Test API error: ${error}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  metricsServer.listen(metricsPort, () => {
    log(`Metrics server running on port ${metricsPort}`);
  });

  try {
    const client = await createWhatsAppClient(config, {
      authDir: process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp",
    });

    // Keep running
    log("WhatsApp client is running. Press Ctrl+C to stop.");

    // Handle graceful shutdown
    const shutdown = async () => {
      log("Shutting down...");
      await client.disconnect();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }
}

main().catch(console.error);
