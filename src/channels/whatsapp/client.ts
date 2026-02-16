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
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import type { NetworkingEventConfig } from "../../config/types.js";
import type { MessageType } from "../../swarm/types.js";
import type { CreateMessageInput } from "../../history/message-store.js";
import { handleFirstContact, isFirstContact } from "../../handlers/first-contact.js";
import { handleFollowUp, isFollowUpMessage } from "../../handlers/follow-up.js";
import { processVoiceMessage } from "../../handlers/voice-message.js";
import { findContactByPhone } from "../../contacts/index.js";
import { createLogger, createCorrelationId } from "../../observability/logger.js";
import { getMessageStore } from "../../history/message-store.js";
import { createWorker } from "../../queue/client.js";
import type { OutboundMessageJob } from "../../swarm/types.js";
import type { Worker } from "bullmq";
import { startVideoPoller } from "../../workers/video-poller.js";
import { getMediaStore } from "../../storage/media-store.js";
import type { MediaCategory } from "../../storage/types.js";

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

    // Handle incoming calls - reject and send auto-reply
    this.sock.ev.on("call", async (calls) => {
      for (const call of calls) {
        await this.handleIncomingCall(call);
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
      // DEBUG: Log ALL incoming messages for schema development (including view-once)
      const messageKeys = message.message ? Object.keys(message.message).filter(k => message.message?.[k as keyof typeof message.message]) : [];
      msgLogger.info({
        msg: "DEBUG: Raw message received",
        hasMessage: !!message.message,
        hasKey: !!message.key,
        fromMe: message.key?.fromMe,
        messageTypes: messageKeys,
        rawMessage: JSON.stringify(message, (key, value) => {
          // Truncate binary data
          if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
            return `<Buffer ${value.length} bytes>`;
          }
          return value;
        }, 2)
      });

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

      // Extract full message info
      const messageInfo = this.extractMessageInfo(message);
      if (!messageInfo) {
        msgLogger.debug({ msg: "Skipping message - unsupported type" });
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
        messageType: messageInfo.messageType,
        contentPreview: messageInfo.content?.substring(0, 50),
        isViewOnce: messageInfo.isViewOnce,
        isVoiceNote: messageInfo.isVoiceNote,
        isVideoNote: messageInfo.isVideoNote,
        isGif: messageInfo.isGif,
      });

      // Store inbound message with full info
      const messageStore = getMessageStore();
      await messageStore.storeMessage({
        phoneNumber,
        correlationId,
        direction: "inbound",
        channel: "whatsapp",
        ...messageInfo,
      });

      // For non-text messages, we may still want to process them
      // but handlers currently only work with text
      let text = messageInfo.content;

      // Check if first contact or follow-up
      const contact = await findContactByPhone(phoneNumber, this.config.supabase ?? {});

      msgLogger.debug({
        msg: "Contact lookup result",
        found: !!contact,
        sentPersonalizedMessage: contact?.sent_personalized_message,
        status: contact?.status
      });

      // Handle voice messages - transcribe before processing
      if (messageInfo.isVoiceNote && contact) {
        msgLogger.info({ msg: "Processing voice message", phoneNumber });

        const mediaResult = await this.downloadAndStoreMedia(message, phoneNumber, contact.id);

        if (mediaResult.success && mediaResult.storageKey) {
          const transcription = await processVoiceMessage({
            phoneNumber,
            mediaStorageKey: mediaResult.storageKey,
            mediaMimetype: messageInfo.mediaMimetype || "audio/ogg",
            durationSeconds: messageInfo.mediaDurationSeconds,
            config: this.config,
            correlationId,
          });

          if (transcription.success && transcription.transcription) {
            msgLogger.info({
              msg: "Voice message transcribed",
              textLength: transcription.transcription.length,
              language: transcription.language,
            });
            text = transcription.transcription; // Use transcribed text for AI processing
          } else {
            msgLogger.warn({
              msg: "Voice transcription failed",
              error: transcription.error,
            });
          }
        } else {
          msgLogger.warn({
            msg: "Failed to download voice message",
            error: mediaResult.error,
          });
        }
      }

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
            sendMessage: async (msg) => this.sendMessage(chatId, msg, { phoneNumber }),
          });
          msgLogger.info({ msg: "First contact handled successfully" });
        }
      } else if (text) {
        // Follow-up (only if we have text content to process)
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
            sendMessage: async (msg) => this.sendMessage(chatId, msg, { phoneNumber }),
          });
          msgLogger.info({ msg: "Follow-up handled", result });
        }
      } else {
        msgLogger.debug({ msg: "Skipping follow-up handling - no text content for AI processing" });
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
   * Handle incoming call - reject and send auto-reply
   */
  private async handleIncomingCall(call: {
    chatId: string;
    from: string;
    id: string;
    date: Date;
    isVideo?: boolean;
    status: string;
    offline: boolean;
  }): Promise<void> {
    const correlationId = createCorrelationId();
    const callLogger = createLogger({ channel: "whatsapp", correlationId, component: "call-handler" });

    try {
      // Only handle incoming call offers
      if (call.status !== "offer") {
        callLogger.debug({
          msg: "Ignoring call event",
          status: call.status,
          from: call.from,
        });
        return;
      }

      const isVideo = call.isVideo ?? false;
      const callType = isVideo ? "video" : "voice";

      callLogger.info({
        msg: "Incoming call detected",
        from: call.from,
        callType,
        callId: call.id,
      });

      // Reject the call
      if (this.sock) {
        try {
          await this.sock.rejectCall(call.id, call.from);
          callLogger.info({ msg: "Call rejected", callId: call.id });
        } catch (rejectError) {
          callLogger.warn({
            msg: "Failed to reject call (may have already ended)",
            error: rejectError instanceof Error ? rejectError.message : String(rejectError),
          });
        }
      }

      // Extract phone number from the call.from JID
      let phoneNumber: string;
      if (call.from.endsWith("@lid")) {
        // LID format - extract number
        phoneNumber = call.from.replace("@lid", "");
      } else {
        phoneNumber = call.from.replace("@s.whatsapp.net", "");
      }

      // Send auto-reply message
      const autoReplyMessage = `Hey! I can't take ${callType} calls right now, but I'm here and ready to chat! 🎤

Send me a voice message and I'll respond right away - my AI assistant transcribes and processes them instantly.

What's on your mind?`;

      await this.sendMessage(call.chatId, autoReplyMessage, { phoneNumber, correlationId });

      callLogger.info({
        msg: "Auto-reply sent after call rejection",
        phoneNumber,
        callType,
      });

    } catch (error) {
      callLogger.error({
        msg: "Error handling incoming call",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Extracted message info from WhatsApp
   */
  private extractMessageInfo(message: proto.IWebMessageInfo): Partial<CreateMessageInput> | null {
    const msg = message.message;
    if (!msg) return null;

    // Check for view-once wrappers first
    const viewOnceMsg = msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message;
    const actualMsg = viewOnceMsg || msg;
    const isViewOnce = !!viewOnceMsg;

    // Text message (conversation)
    if (actualMsg.conversation) {
      return {
        messageType: "text",
        content: actualMsg.conversation,
        isViewOnce,
      };
    }

    // Extended text message (with links/mentions)
    if (actualMsg.extendedTextMessage?.text) {
      return {
        messageType: "text",
        content: actualMsg.extendedTextMessage.text,
        isViewOnce,
      };
    }

    // Image message
    if (actualMsg.imageMessage) {
      const img = actualMsg.imageMessage;
      return {
        messageType: "image",
        content: img.caption || undefined,
        mediaUrl: img.directPath || undefined,
        mediaMimetype: img.mimetype || undefined,
        mediaSizeBytes: img.fileLength ? Number(img.fileLength) : undefined,
        mediaWidth: img.width || undefined,
        mediaHeight: img.height || undefined,
        isViewOnce: isViewOnce || img.viewOnce || false,
      };
    }

    // Video message (includes GIFs and video notes)
    if (actualMsg.videoMessage) {
      const vid = actualMsg.videoMessage;
      return {
        messageType: "video",
        content: vid.caption || undefined,
        mediaUrl: vid.directPath || undefined,
        mediaMimetype: vid.mimetype || undefined,
        mediaSizeBytes: vid.fileLength ? Number(vid.fileLength) : undefined,
        mediaDurationSeconds: vid.seconds || undefined,
        mediaWidth: vid.width || undefined,
        mediaHeight: vid.height || undefined,
        isGif: vid.gifPlayback || false,
        isViewOnce: isViewOnce || vid.viewOnce || false,
      };
    }

    // PTV message (video note - circular video)
    if (actualMsg.ptvMessage) {
      const ptv = actualMsg.ptvMessage;
      return {
        messageType: "video",
        content: ptv.caption || undefined,
        mediaUrl: ptv.directPath || undefined,
        mediaMimetype: ptv.mimetype || undefined,
        mediaSizeBytes: ptv.fileLength ? Number(ptv.fileLength) : undefined,
        mediaDurationSeconds: ptv.seconds || undefined,
        mediaWidth: ptv.width || undefined,
        mediaHeight: ptv.height || undefined,
        isVideoNote: true,
        isViewOnce,
      };
    }

    // Audio message (includes voice notes)
    if (actualMsg.audioMessage) {
      const aud = actualMsg.audioMessage;
      return {
        messageType: "audio",
        mediaUrl: aud.directPath || undefined,
        mediaMimetype: aud.mimetype || undefined,
        mediaSizeBytes: aud.fileLength ? Number(aud.fileLength) : undefined,
        mediaDurationSeconds: aud.seconds || undefined,
        isVoiceNote: aud.ptt || false,
        isViewOnce: isViewOnce || aud.viewOnce || false,
      };
    }

    // Document message
    if (actualMsg.documentMessage) {
      const doc = actualMsg.documentMessage;
      return {
        messageType: "document",
        content: doc.caption || doc.fileName || undefined,
        mediaUrl: doc.directPath || undefined,
        mediaMimetype: doc.mimetype || undefined,
        mediaSizeBytes: doc.fileLength ? Number(doc.fileLength) : undefined,
        isViewOnce,
      };
    }

    // Sticker message
    if (actualMsg.stickerMessage) {
      const sticker = actualMsg.stickerMessage;
      return {
        messageType: "sticker",
        mediaUrl: sticker.directPath || undefined,
        mediaMimetype: sticker.mimetype || undefined,
        mediaSizeBytes: sticker.fileLength ? Number(sticker.fileLength) : undefined,
        mediaWidth: sticker.width || undefined,
        mediaHeight: sticker.height || undefined,
        isAnimated: sticker.isAnimated || sticker.isLottie || false,
        isViewOnce,
      };
    }

    // Location message
    if (actualMsg.locationMessage) {
      const loc = actualMsg.locationMessage;
      return {
        messageType: "location",
        content: loc.comment || undefined,
        locationLatitude: loc.degreesLatitude || undefined,
        locationLongitude: loc.degreesLongitude || undefined,
        locationName: loc.name || undefined,
        locationAddress: loc.address || undefined,
        isViewOnce,
      };
    }

    // Live location message
    if (actualMsg.liveLocationMessage) {
      const loc = actualMsg.liveLocationMessage;
      return {
        messageType: "location",
        content: loc.caption || undefined,
        locationLatitude: loc.degreesLatitude || undefined,
        locationLongitude: loc.degreesLongitude || undefined,
        isViewOnce,
      };
    }

    return null;
  }

  /**
   * Extract text from message (for backward compatibility)
   */
  private extractMessageText(message: proto.IWebMessageInfo): string | null {
    const info = this.extractMessageInfo(message);
    return info?.content || null;
  }

  /**
   * Send a text message with typing indicator
   * @param chatId - WhatsApp chat ID (JID)
   * @param text - Message text
   * @param options - Optional parameters for correlation and phone number override
   */
  async sendMessage(
    chatId: string,
    text: string,
    options?: { correlationId?: string; phoneNumber?: string }
  ): Promise<void> {
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

    // Store outbound message - use provided phoneNumber or extract from chatId
    const phoneNumber = options?.phoneNumber || chatId.replace("@s.whatsapp.net", "").replace("@lid", "");
    const messageStore = getMessageStore();
    await messageStore.storeOutboundMessage(
      phoneNumber,
      text,
      "whatsapp",
      options?.correlationId || createCorrelationId()
    );
  }

  /**
   * Send a message by phone number
   */
  async sendMessageByPhone(phoneNumber: string, text: string): Promise<void> {
    // Normalize phone number
    const normalized = phoneNumber.replace(/[^0-9]/g, "");
    const chatId = `${normalized}@s.whatsapp.net`;

    await this.sendMessage(chatId, text, { phoneNumber: normalized });
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

    // Detect mimetype from file extension
    const isOgg = audioPath.endsWith(".ogg");
    const mimetype = isOgg ? "audio/ogg; codecs=opus" : "audio/mpeg";
    log(`Using mimetype: ${mimetype}`);

    // Show recording indicator briefly
    await this.sock.sendPresenceUpdate("recording", chatId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.sock.sendPresenceUpdate("paused", chatId);

    // Send as voice note (ptt = push to talk)
    await this.sock.sendMessage(chatId, {
      audio: audioBuffer,
      mimetype,
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

  /**
   * Download and store received media with GDPR tracking
   */
  async downloadAndStoreMedia(
    message: proto.IWebMessageInfo,
    phoneNumber: string,
    contactId?: string
  ): Promise<{ success: boolean; storageKey?: string; error?: string }> {
    if (!this.sock) {
      return { success: false, error: "WhatsApp not connected" };
    }

    const msg = message.message;
    if (!msg || !message.key) {
      return { success: false, error: "No message content or key" };
    }

    // Check for view-once wrappers
    const viewOnceMsg = msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message;
    const actualMsg = viewOnceMsg || msg;

    // Determine media type and mime type
    let mediaType: MediaCategory | null = null;
    let mimeType: string | null = null;

    if (actualMsg.imageMessage) {
      mediaType = "image";
      mimeType = actualMsg.imageMessage.mimetype || "image/jpeg";
    } else if (actualMsg.videoMessage) {
      mediaType = "video";
      mimeType = actualMsg.videoMessage.mimetype || "video/mp4";
    } else if (actualMsg.audioMessage) {
      mediaType = "voice";
      mimeType = actualMsg.audioMessage.mimetype || "audio/ogg";
    } else if (actualMsg.documentMessage) {
      mediaType = "document";
      mimeType = actualMsg.documentMessage.mimetype || "application/octet-stream";
    } else if (actualMsg.stickerMessage) {
      mediaType = "image";
      mimeType = actualMsg.stickerMessage.mimetype || "image/webp";
    }

    if (!mediaType || !mimeType) {
      return { success: false, error: "Unsupported media type" };
    }

    try {
      // Download media using Baileys
      // Cast to the expected type since we've already validated key exists
      const waMessage = message as Parameters<typeof downloadMediaMessage>[0];
      const buffer = await downloadMediaMessage(
        waMessage,
        "buffer",
        {},
        {
          logger: {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: console.warn,
            error: console.error,
            level: "warn" as const,
            child: () => ({
              trace: () => {},
              debug: () => {},
              info: () => {},
              warn: console.warn,
              error: console.error,
              level: "warn" as const,
              child: function() { return this; },
            }),
          } as never,
          reuploadRequest: this.sock.updateMediaMessage,
        }
      );

      if (!buffer) {
        return { success: false, error: "Failed to download media" };
      }

      // Store with MediaStore for GDPR tracking
      const mediaStore = getMediaStore();
      const result = await mediaStore.store({
        phoneNumber,
        contactId,
        mediaType,
        data: buffer as Buffer,
        mimeType,
        source: "received",
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      log(`Stored received ${mediaType} from ${phoneNumber}: ${result.storageKey}`);

      return {
        success: true,
        storageKey: result.storageKey,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
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
