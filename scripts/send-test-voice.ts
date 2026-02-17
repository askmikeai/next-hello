#!/usr/bin/env npx tsx
/**
 * Send Test Messages to AI Assistant
 *
 * Sends messages from Session 1 to the AI assistant to test voice flow.
 *
 * Session 1: 17542959900 (sender)
 * AI Assistant: 13054277457 (receiver)
 *
 * Usage:
 *   npx tsx scripts/send-test-voice.ts [message]
 *   npx tsx scripts/send-test-voice.ts "Hello from voice test"
 *   npx tsx scripts/send-test-voice.ts --voice "This is a voice message"
 */

import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Session 1 sends TO the AI assistant
const SENDER_SESSION = {
  name: "session-1",
  phone: "17542959900",
  authDir: path.join(projectRoot, "data", "auth", "whatsapp-session-1"),
};

// AI Assistant phone number
const AI_ASSISTANT_PHONE = "13054277457";

function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[${timestamp}] ${message}`);
}

async function createSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(SENDER_SESSION.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: {
      level: "silent",
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
      trace: () => {},
      child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, trace: () => {}, child: () => ({}) } as any),
    } as any,
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
}

async function waitForConnection(sock: ReturnType<typeof makeWASocket>): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log("Connection timeout");
      resolve(false);
    }, 15000);

    sock.ev.on("connection.update", (update) => {
      if (update.connection === "open") {
        clearTimeout(timeout);
        const phone = sock.user?.id?.split(":")[0] || "unknown";
        log(`Connected as ${phone}`);
        resolve(true);
      } else if (update.connection === "close") {
        clearTimeout(timeout);
        log("Connection closed");
        resolve(false);
      }
    });
  });
}

async function sendTextMessage(sock: ReturnType<typeof makeWASocket>, message: string): Promise<void> {
  const chatId = `${AI_ASSISTANT_PHONE}@s.whatsapp.net`;
  log(`Sending text to AI Assistant (${AI_ASSISTANT_PHONE}): "${message}"`);
  await sock.sendMessage(chatId, { text: message });
  log("✓ Message sent!");
}

async function sendVoiceMessage(sock: ReturnType<typeof makeWASocket>, audioPath: string): Promise<void> {
  const chatId = `${AI_ASSISTANT_PHONE}@s.whatsapp.net`;

  if (!fs.existsSync(audioPath)) {
    log(`Audio file not found: ${audioPath}`);
    return;
  }

  log(`Sending voice message to AI Assistant (${AI_ASSISTANT_PHONE})`);
  const audioBuffer = fs.readFileSync(audioPath);

  await sock.sendMessage(chatId, {
    audio: audioBuffer,
    mimetype: "audio/ogg; codecs=opus",
    ptt: true, // Push-to-talk (voice note)
  });
  log("✓ Voice message sent!");
}

async function listenForResponses(sock: ReturnType<typeof makeWASocket>, duration: number = 30000): Promise<void> {
  log(`Listening for responses for ${duration / 1000} seconds...`);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      // Only show messages from the AI assistant
      const from = msg.key.remoteJid?.replace("@s.whatsapp.net", "") || "";
      if (from === AI_ASSISTANT_PHONE && !msg.key.fromMe) {
        const timestamp = new Date().toISOString().split("T")[1].split(".")[0];

        if (msg.message?.conversation) {
          console.log(`\n[${timestamp}] 📨 AI Response (text): "${msg.message.conversation}"`);
        } else if (msg.message?.extendedTextMessage?.text) {
          console.log(`\n[${timestamp}] 📨 AI Response (text): "${msg.message.extendedTextMessage.text}"`);
        } else if (msg.message?.audioMessage) {
          console.log(`\n[${timestamp}] 🎤 AI Response (VOICE MESSAGE received!)`);
          console.log(`   Duration: ${msg.message.audioMessage.seconds}s`);
          console.log(`   PTT: ${msg.message.audioMessage.ptt}`);
        } else {
          console.log(`\n[${timestamp}] 📨 AI Response (other type):`, Object.keys(msg.message || {}));
        }
      }
    }
  });

  await new Promise(r => setTimeout(r, duration));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let isVoice = false;
  let message = "Hi! This is a test message.";
  let audioPath = "";

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--voice" || args[i] === "-v") {
      isVoice = true;
      if (args[i + 1] && !args[i + 1].startsWith("-")) {
        audioPath = args[i + 1];
        i++;
      }
    } else if (args[i] === "--text" || args[i] === "-t") {
      if (args[i + 1]) {
        message = args[i + 1];
        i++;
      }
    } else if (!args[i].startsWith("-")) {
      message = args[i];
    }
  }

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       SEND TEST MESSAGE TO AI ASSISTANT                    ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  From:    ${SENDER_SESSION.phone}                                ║`);
  console.log(`║  To:      ${AI_ASSISTANT_PHONE} (AI Assistant)                   ║`);
  console.log(`║  Type:    ${isVoice ? "VOICE" : "TEXT"}                                          ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");

  // Connect
  log("Connecting to WhatsApp...");
  const sock = await createSocket();
  const connected = await waitForConnection(sock);

  if (!connected) {
    console.error("Failed to connect. Run: npm run connect:session1");
    process.exit(1);
  }

  try {
    if (isVoice && audioPath) {
      await sendVoiceMessage(sock, audioPath);
    } else {
      await sendTextMessage(sock, message);
    }

    // Listen for responses
    await listenForResponses(sock, 30000);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    sock.end(undefined);
    log("Disconnected");
  }
}

main().catch(console.error);
