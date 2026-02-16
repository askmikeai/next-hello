#!/usr/bin/env npx tsx
/**
 * Multi-Session WhatsApp Connection Script
 *
 * Connect additional WhatsApp accounts for testing multi-session scenarios.
 * Each session uses a separate auth directory.
 *
 * Usage:
 *   npx tsx scripts/connect-session.ts <session-name> <phone-number>
 *
 * Examples:
 *   npx tsx scripts/connect-session.ts session-1 17542959900
 *   npx tsx scripts/connect-session.ts session-2 13054272115
 *
 * This will create auth directories:
 *   ./data/auth/whatsapp-session-1
 *   ./data/auth/whatsapp-session-2
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Get session name and phone number from command line
const sessionName = process.argv[2];
const expectedPhone = process.argv[3];

if (!sessionName || !expectedPhone) {
  console.error("");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("  WhatsApp Multi-Session Connector");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("");
  console.error("Usage: npx tsx scripts/connect-session.ts <session-name> <phone-number>");
  console.error("");
  console.error("Arguments:");
  console.error("  session-name   Unique name for this session (e.g., session-1)");
  console.error("  phone-number   Expected phone number to verify connection");
  console.error("");
  console.error("Examples:");
  console.error("  npx tsx scripts/connect-session.ts session-1 17542959900");
  console.error("  npx tsx scripts/connect-session.ts session-2 13054272115");
  console.error("");
  process.exit(1);
}

// Normalize expected phone number (remove non-digits)
const normalizedExpectedPhone = expectedPhone.replace(/[^0-9]/g, "");

const authDir = path.join(projectRoot, "data", "auth", `whatsapp-${sessionName}`);

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${sessionName}] ${message}`);
}

async function connectSession(): Promise<void> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  WhatsApp Session: ${sessionName}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log(`  Expected Phone: ${normalizedExpectedPhone}`);
  console.log(`  Auth directory: ${authDir}`);
  console.log("");
  console.log("  A QR code will appear below - scan it with your phone:");
  console.log("");
  console.log("  1. Open WhatsApp on your phone");
  console.log("  2. Go to Settings > Linked Devices");
  console.log("  3. Tap 'Link a Device'");
  console.log("  4. Scan the QR code below");
  console.log("");
  console.log("  WARNING: Make sure you scan with the phone number:");
  console.log(`           ${normalizedExpectedPhone}`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  // Ensure auth directory exists
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  log(`Using Baileys version: ${version.join(".")}`);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // We'll handle QR display ourselves
    logger: {
      level: "silent",
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: (msg: unknown) => console.error(`[${sessionName}] ERROR:`, msg),
      trace: () => {},
      child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, trace: () => {}, child: () => ({}) } as any),
    } as any,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("");
      console.log(`QR Code for ${sessionName}:`);
      console.log("Scan this with WhatsApp on your phone:");
      console.log("");
      qrcode.generate(qr, { small: true });
      console.log("");
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

      log(`Connection closed. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => {
          connectSession();
        }, 3000);
      } else {
        log("Logged out. Please delete auth directory and restart to reconnect.");
        process.exit(0);
      }
    } else if (connection === "open") {
      const rawId = sock.user?.id || "unknown";
      // Extract phone number (format: "1234567890:123@s.whatsapp.net" or similar)
      const phoneNumber = rawId.split(":")[0].replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "");

      console.log("");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      // Verify phone number matches expected
      if (phoneNumber.includes(normalizedExpectedPhone) || normalizedExpectedPhone.includes(phoneNumber)) {
        console.log(`  ✓ Connected: ${sessionName}`);
        console.log(`  ✓ Phone VERIFIED: ${phoneNumber}`);
        console.log(`  ✓ Expected: ${normalizedExpectedPhone}`);
      } else {
        console.log(`  ⚠ Connected: ${sessionName}`);
        console.log(`  ⚠ Phone MISMATCH!`);
        console.log(`    Connected: ${phoneNumber}`);
        console.log(`    Expected:  ${normalizedExpectedPhone}`);
        console.log("");
        console.log("  WARNING: You connected a different phone number!");
        console.log("  Please disconnect and try again with the correct phone.");
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("");
      log("Session is active. Press Ctrl+C to disconnect.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const phoneNumber = msg.key.remoteJid?.replace("@s.whatsapp.net", "") || "unknown";
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text ||
                   "[media message]";

      log(`Received from ${phoneNumber}: ${text.substring(0, 50)}...`);
    }
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    log("Shutting down...");
    sock.end(undefined);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

connectSession().catch((error) => {
  console.error("Failed to connect:", error);
  process.exit(1);
});
