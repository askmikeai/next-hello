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
import { findContactByPhone } from "../../contacts/index.js";
import { createLogger, createCorrelationId } from "../../observability/logger.js";
import { createWorker } from "../../queue/client.js";
import type { OutboundMessageJob } from "../../swarm/types.js";
import type { Worker } from "bullmq";
import { startVideoPoller } from "../../workers/video-poller.js";

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? "./data/auth/whatsapp";

// Create WhatsApp-specific logger
const logger = createLogger({ channel: "whatsapp" });

function log(message: string): void {
  logger.info({ msg: message });
}

function debug(message: string, data?: Record<string, unknown>): void {
  logger.debug({ msg: message, ...data });
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
    const correlationId = createCorrelationId();
    const msgLogger = createLogger({ channel: "whatsapp", correlationId });

    try {
      // Skip if no message content or key
      if (!message.message || !message.key) {
        msgLogger.debug({ msg: "Skipping message - no content or key" });
        return;
      }

      // Skip our own messages
      if (message.key.fromMe) {
        msgLogger.debug({ msg: "Skipping own message" });
        return;
      }

      // Skip group messages (for now)
      const chatId = message.key.remoteJid;
      if (!chatId || chatId.endsWith("@g.us")) {
        msgLogger.debug({ msg: "Skipping group message", chatId });
        return;
      }

      // Extract message text
      const text = this.extractMessageText(message);
      if (!text) {
        msgLogger.debug({ msg: "Skipping message - no text content" });
        return;
      }

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

      msgLogger.info({
        msg: "Incoming message",
        phoneNumber,
        pushName,
        textPreview: text.substring(0, 50),
        textLength: text.length
      });

      // Check if first contact or follow-up
      const contact = await findContactByPhone(phoneNumber, this.config.supabase ?? {});

      msgLogger.debug({
        msg: "Contact lookup result",
        found: !!contact,
        sentPersonalizedMessage: contact?.sent_personalized_message,
        status: contact?.status
      });

      if (!contact || !contact.sent_personalized_message) {
        // First contact
        msgLogger.info({ msg: "Handling as FIRST CONTACT", phoneNumber });
        if (isFirstContact({
          phoneNumber,
          isGroup: false,
          isFromMe: false,
          config: this.config,
        })) {
          msgLogger.debug({ msg: "Calling handleFirstContact handler" });
          await handleFirstContact({
            phoneNumber,
            pushName,
            channel: "whatsapp",
            config: this.config,
            sendMessage: async (msg) => this.sendMessage(chatId, msg),
          });
          msgLogger.info({ msg: "First contact handled successfully" });
        }
      } else {
        // Follow-up
        msgLogger.info({ msg: "Handling as FOLLOW-UP", phoneNumber, swarmEnabled: this.config.swarm?.enabled });
        if (isFollowUpMessage({
          phoneNumber,
          isGroup: false,
          isFromMe: false,
          config: this.config,
        })) {
          msgLogger.debug({ msg: "Calling handleFollowUp handler", swarmRollout: this.config.swarm?.rolloutPercentage });
          const result = await handleFollowUp({
            phoneNumber,
            messageText: text,
            config: this.config,
            sendMessage: async (msg) => this.sendMessage(chatId, msg),
          });
          msgLogger.info({ msg: "Follow-up handled", result });
        }
      }
    } catch (error) {
      msgLogger.error({
        msg: "Error handling message",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
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
   * Send a voice message by phone number
   */
  async sendVoiceByPhone(phoneNumber: string, audioPath: string): Promise<void> {
    if (!this.sock) {
      throw new Error("WhatsApp not connected");
    }

    const normalized = phoneNumber.replace(/[^0-9]/g, "");
    const chatId = `${normalized}@s.whatsapp.net`;

    log(`Sending voice message from: ${audioPath}`);

    // Read the audio file
    const audioBuffer = fs.readFileSync(audioPath);
    log(`Loaded voice message: ${(audioBuffer.length / 1024).toFixed(2)} KB`);

    // Show recording indicator briefly
    await this.sock.sendPresenceUpdate("recording", chatId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.sock.sendPresenceUpdate("paused", chatId);

    // Send as voice note (ptt = push to talk)
    await this.sock.sendMessage(chatId, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      ptt: true, // This makes it appear as a voice note, not an audio file
    });

    log(`Voice message sent to ${phoneNumber}`);
  }

  /**
   * Send a video message by phone number
   */
  async sendVideoByPhone(phoneNumber: string, videoUrl: string, caption?: string): Promise<void> {
    if (!this.sock) {
      throw new Error("WhatsApp not connected");
    }

    const normalized = phoneNumber.replace(/[^0-9]/g, "");
    const chatId = `${normalized}@s.whatsapp.net`;

    log(`Downloading video from: ${videoUrl.substring(0, 50)}...`);

    // Download the video first
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    const videoBuffer = Buffer.from(await response.arrayBuffer());
    log(`Downloaded video: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Show typing indicator
    await this.sock.sendPresenceUpdate("composing", chatId);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this.sock.sendPresenceUpdate("paused", chatId);

    // Send video as attachment
    await this.sock.sendMessage(chatId, {
      video: videoBuffer,
      caption: caption || undefined,
      mimetype: "video/mp4",
    });

    log(`Video sent to ${phoneNumber}`);
  }

  /**
   * Start the outbound message worker
   * Returns null if Redis is unavailable
   */
  startOutboundWorker(): Worker<OutboundMessageJob, void> | null {
    log("Starting outbound message worker...");

    const worker = createWorker<OutboundMessageJob, void>(
      "outbound-messages",
      async (job) => {
        const { phoneNumber, messageType, content, caption } = job.data;
        const jobLogger = createLogger({
          channel: "whatsapp",
          correlationId: job.data.correlationId,
          jobId: job.id
        });

        jobLogger.info({ msg: "Processing outbound message", phoneNumber, messageType });

        try {
          if (messageType === "video") {
            await this.sendVideoByPhone(phoneNumber, content, caption);
          } else if (messageType === "voice") {
            await this.sendVoiceByPhone(phoneNumber, content);
          } else {
            await this.sendMessageByPhone(phoneNumber, content);
          }
          jobLogger.info({ msg: "Outbound message sent successfully" });
        } catch (error) {
          jobLogger.error({
            msg: "Failed to send outbound message",
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
      },
      { concurrency: 1 } // Process one at a time to avoid rate limits
    );

    if (!worker) {
      log("Outbound worker not started - Redis unavailable");
      return null;
    }

    worker.on("completed", (job) => {
      log(`Outbound job ${job.id} completed`);
    });

    worker.on("failed", (job, error) => {
      log(`Outbound job ${job?.id} failed: ${error.message}`);
    });

    return worker;
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
  options?: Partial<WhatsAppClientOptions> & {
    startOutboundWorker?: boolean;
    startVideoPoller?: boolean;
  },
): Promise<WhatsAppClient> {
  const client = new WhatsAppClient({
    config,
    authDir: options?.authDir,
  });

  await client.connect();

  // Start outbound message worker by default (for sending videos, etc.)
  if (options?.startOutboundWorker !== false) {
    client.startOutboundWorker();
  }

  // Start video poller by default (checks for completed HeyGen videos every minute)
  if (options?.startVideoPoller !== false) {
    startVideoPoller();
  }

  return client;
}
