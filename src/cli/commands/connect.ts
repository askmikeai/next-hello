/**
 * Connect Command
 *
 * Connect messaging channels (WhatsApp, etc.)
 */

import inquirer from "inquirer";
import ora from "ora";
import fs from "fs";
import {
  printBanner,
  printSection,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printCommand,
  colors,
  symbols,
} from "../ui.js";
import { createWhatsAppClient } from "../../channels/whatsapp/client.js";
import { safeParseConfig } from "../../config/schema.js";
import type { NetworkingEventConfig } from "../../config/types.js";

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

export async function connectCommand(channel?: string): Promise<void> {
  printBanner();

  if (!channel) {
    const { selectedChannel } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedChannel",
        message: "Which channel do you want to connect?",
        choices: [
          { name: "WhatsApp", value: "whatsapp" },
          { name: "Telegram (coming soon)", value: "telegram", disabled: true },
          { name: "SMS (coming soon)", value: "sms", disabled: true },
        ],
      },
    ]);
    channel = selectedChannel;
  }

  if (channel === "whatsapp") {
    await connectWhatsApp();
  } else {
    printError(`Channel '${channel}' is not yet supported.`);
  }
}

async function connectWhatsApp(): Promise<void> {
  printSection("WhatsApp Connection");

  console.log("This will connect your WhatsApp account to NextHello.");
  console.log("");
  console.log(colors.dim("A QR code will appear below. To link your account:"));
  console.log("");
  console.log(`  ${symbols.arrow} Open WhatsApp on your phone`);
  console.log(`  ${symbols.arrow} Go to ${colors.bold("Settings > Linked Devices")}`);
  console.log(`  ${symbols.arrow} Tap ${colors.bold("Link a Device")}`);
  console.log(`  ${symbols.arrow} Scan the QR code`);
  console.log("");

  const { ready } = await inquirer.prompt([
    {
      type: "confirm",
      name: "ready",
      message: "Ready to connect?",
      default: true,
    },
  ]);

  if (!ready) {
    printInfo("Connection cancelled.");
    return;
  }

  const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp";

  // Check for existing session
  if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
    const { clearSession } = await inquirer.prompt([
      {
        type: "confirm",
        name: "clearSession",
        message: "Found existing WhatsApp session. Clear and reconnect?",
        default: false,
      },
    ]);

    if (clearSession) {
      fs.rmSync(authDir, { recursive: true, force: true });
      printInfo("Cleared existing session.");
    }
  }

  console.log("");

  const spinner = ora("Initializing WhatsApp connection...").start();

  try {
    const config = loadConfig();

    spinner.succeed("WhatsApp client initialized");
    console.log("");

    const client = await createWhatsAppClient(config, { authDir });

    // Keep the process running
    console.log("");
    printSuccess("WhatsApp is connected and listening for messages!");
    console.log("");
    printInfo("Press Ctrl+C to disconnect.");
    console.log("");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("");
      const stopSpinner = ora("Disconnecting...").start();
      await client.disconnect();
      stopSpinner.succeed("Disconnected from WhatsApp");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    spinner.fail("Failed to connect");
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
