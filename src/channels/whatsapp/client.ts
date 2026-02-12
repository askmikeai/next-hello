/**
 * WhatsApp Client using Baileys
 *
 * Connects to WhatsApp Web and handles incoming/outgoing messages.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import type { NetworkingEventConfig } from "../../config/types.js";
import { handleFirstContact, isFirstContact } from "../../handlers/first-contact.js";
import { handleFollowUp, isFollowUpMessage } from "../../handlers/follow-up.js";
import { findContactByPhone } from "../../contacts/supabase-repo.js";

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp";

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [whatsapp] ${message}`);
}

export interface WhatsAppClientOptions {
  config: NetworkingEventConfig;
  authDir?: string;
}

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private config: NetworkingEventConfig;
  private authDir: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(options: WhatsAppClientOptions) {
    this.config = options.config;
    this.authDir = options.authDir ?? AUTH_DIR;
  }

  /**
   * Connect to WhatsApp
   */
  async connect(): Promise<void> {
    log("Connecting to WhatsApp...");

    // Ensure auth directory exists
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    // Create a minimal logger
    const logger = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
      level: "warn" as const,
      child: () => logger,
    };

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger as never),
      },
      version,
      browser: ["NextHello", "Desktop", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Save credentials on update
    this.sock.ev.on("creds.update", saveCreds);

    // Handle connection updates
    this.sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log("Scan this QR code with WhatsApp:");
        console.log("");
        qrcode.generate(qr, { small: true });
        console.log("");
        log("Go to WhatsApp > Settings > Linked Devices > Link a Device");
      }

      if (connection === "close") {
        const error = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        log(`Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          setTimeout(() => this.connect(), 3000);
        } else if (statusCode === DisconnectReason.loggedOut) {
          log("Logged out. Please delete auth directory and reconnect.");
          // Clear auth
          if (fs.existsSync(this.authDir)) {
            fs.rmSync(this.authDir, { recursive: true });
          }
        }
      } else if (connection === "open") {
        this.reconnectAttempts = 0;
        log("Connected to WhatsApp!");
        log(`Phone: ${this.sock?.user?.id ?? "unknown"}`);
      }
    });

    // Handle incoming messages
    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages) {
        await this.handleIncomingMessage(message);
      }
    });

    log("WhatsApp client initialized. Waiting for connection...");
  }

  /**
   * Handle incoming message
   */
  private async handleIncomingMessage(message: proto.IWebMessageInfo): Promise<void> {
    try {
      // Skip if no message content or key
      if (!message.message || !message.key) return;

      // Skip our own messages
      if (message.key.fromMe) return;

      // Skip group messages (for now)
      const chatId = message.key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us")) {
        return;
      }

      // Extract message text
      const text = this.extractMessageText(message);
      if (!text) return;

      // Extract sender info - handle both @s.whatsapp.net and @lid formats
      // For @lid (Link ID) format, the actual phone is in remoteJidAlt
      let phoneNumber: string;
      if (chatId.endsWith("@lid")) {
        // LID format - use remoteJidAlt which contains the actual phone number
        const remoteJidAlt = (message.key as { remoteJidAlt?: string }).remoteJidAlt;
        if (remoteJidAlt && remoteJidAlt.includes("@s.whatsapp.net")) {
          phoneNumber = remoteJidAlt.replace("@s.whatsapp.net", "");
        } else {
          // Fallback to LID number as identifier
          phoneNumber = chatId.replace("@lid", "");
        }
      } else {
        phoneNumber = chatId.replace("@s.whatsapp.net", "");
      }
      const pushName = message.pushName ?? undefined;

      log(`Message from ${phoneNumber} (${pushName ?? "unknown"}): ${text.substring(0, 50)}...`);

      // Check if first contact or follow-up
      const contact = await findContactByPhone(phoneNumber, this.config.supabase ?? {});

      if (!contact || !contact.sent_personalized_message) {
        // First contact
        if (isFirstContact({
          phoneNumber,
          isGroup: false,
          isFromMe: false,
          config: this.config,
        })) {
          await handleFirstContact({
            phoneNumber,
            pushName,
            channel: "whatsapp",
            config: this.config,
            sendMessage: async (msg) => this.sendMessage(chatId, msg),
          });
        }
      } else {
        // Follow-up
        if (isFollowUpMessage({
          phoneNumber,
          isGroup: false,
          isFromMe: false,
          config: this.config,
        })) {
          await handleFollowUp({
            phoneNumber,
            messageText: text,
            config: this.config,
            sendMessage: async (msg) => this.sendMessage(chatId, msg),
          });
        }
      }
    } catch (error) {
      log(`Error handling message: ${error}`);
    }
  }

  /**
   * Extract text from message
   */
  private extractMessageText(message: proto.IWebMessageInfo): string | null {
    const msg = message.message;
    if (!msg) return null;

    // Try different message types
    if (msg.conversation) {
      return msg.conversation;
    }
    if (msg.extendedTextMessage?.text) {
      return msg.extendedTextMessage.text;
    }
    if (msg.imageMessage?.caption) {
      return msg.imageMessage.caption;
    }
    if (msg.videoMessage?.caption) {
      return msg.videoMessage.caption;
    }
    if (msg.documentMessage?.caption) {
      return msg.documentMessage.caption;
    }

    return null;
  }

  /**
   * Send a text message with typing indicator
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new Error("WhatsApp not connected");
    }

    log(`Sending to ${chatId}: ${text.substring(0, 50)}...`);

    // Show typing indicator
    await this.sock.sendPresenceUpdate("composing", chatId);

    // Wait 5-10 seconds to simulate typing
    const typingDelay = 5000 + Math.random() * 5000; // 5-10 seconds
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    // Stop typing indicator and send message
    await this.sock.sendPresenceUpdate("paused", chatId);
    await this.sock.sendMessage(chatId, { text });
  }

  /**
   * Send a message by phone number
   */
  async sendMessageByPhone(phoneNumber: string, text: string): Promise<void> {
    // Normalize phone number
    const normalized = phoneNumber.replace(/[^0-9]/g, "");
    const chatId = `${normalized}@s.whatsapp.net`;

    await this.sendMessage(chatId, text);
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.sock) {
      log("Disconnecting...");
      this.sock.end(undefined);
      this.sock = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.sock !== null;
  }

  /**
   * Get the socket (for advanced usage)
   */
  getSocket(): WASocket | null {
    return this.sock;
  }
}

/**
 * Create and connect a WhatsApp client
 */
export async function createWhatsAppClient(
  config: NetworkingEventConfig,
  options?: Partial<WhatsAppClientOptions>,
): Promise<WhatsAppClient> {
  const client = new WhatsAppClient({
    config,
    ...options,
  });

  await client.connect();

  return client;
}
