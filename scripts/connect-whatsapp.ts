#!/usr/bin/env npx tsx
/**
 * Connect WhatsApp Client
 *
 * Non-interactive script to connect the WhatsApp client.
 * Uses existing session if available.
 */

import fs from "fs";
import { createWhatsAppClient } from "../src/channels/whatsapp/client.js";
import { safeParseConfig } from "../src/config/schema.js";
import type { NetworkingEventConfig } from "../src/config/types.js";

function loadConfig(): NetworkingEventConfig {
  const configPaths = ["./nexthello.config.json", "/app/nexthello.config.json"];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(content);
        const result = safeParseConfig(parsed);
        if (result) {
          return result;
        }
      }
    } catch {
      // Continue
    }
  }

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
  console.log("Connecting WhatsApp client...");

  const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp";

  if (!fs.existsSync(authDir) || fs.readdirSync(authDir).length === 0) {
    console.error("No existing WhatsApp session found.");
    console.error("Run the interactive CLI first: npm run connect");
    process.exit(1);
  }

  console.log(`Using existing session from: ${authDir}`);

  try {
    const config = loadConfig();
    console.log(`Config loaded: ${config.eventName} - ${config.ownerName}`);

    const client = await createWhatsAppClient(config, { authDir });

    console.log("\n=== WhatsApp connected and listening ===");
    console.log("Press Ctrl+C to disconnect.\n");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\nDisconnecting...");
      await client.disconnect();
      console.log("Disconnected.");
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
