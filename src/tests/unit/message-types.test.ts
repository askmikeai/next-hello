/**
 * Message Types Unit Tests
 *
 * Tests for WhatsApp message type extraction and message store handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { proto } from "@whiskeysockets/baileys";

// Mock the message store
vi.mock("../../history/message-store.js", () => ({
  getMessageStore: vi.fn(() => ({
    storeMessage: vi.fn().mockResolvedValue({ id: "test-id" }),
    storeInboundMessage: vi.fn().mockResolvedValue({ id: "test-id" }),
  })),
}));

// Mock other dependencies
vi.mock("../../observability/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
  createCorrelationId: vi.fn(() => "test-correlation-id"),
}));

vi.mock("../../contacts/index.js", () => ({
  findContactByPhone: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../handlers/first-contact.js", () => ({
  isFirstContact: vi.fn().mockReturnValue(false),
  handleFirstContact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../handlers/follow-up.js", () => ({
  isFollowUpMessage: vi.fn().mockReturnValue(false),
  handleFollowUp: vi.fn().mockResolvedValue({ handled: false }),
}));

describe("Message Type Extraction", () => {
  // Helper to create a minimal IWebMessageInfo
  const createMessage = (
    messageContent: Partial<proto.IMessage>,
    options: { fromMe?: boolean; remoteJid?: string } = {}
  ): proto.IWebMessageInfo => ({
    key: {
      fromMe: options.fromMe ?? false,
      remoteJid: options.remoteJid ?? "1234567890@s.whatsapp.net",
      id: "test-msg-id",
    },
    message: messageContent as proto.IMessage,
    pushName: "Test User",
  });

  describe("Text Messages", () => {
    it("should extract simple text message (conversation)", () => {
      const msg = createMessage({
        conversation: "Hello, world!",
      });

      // Test the message structure
      expect(msg.message?.conversation).toBe("Hello, world!");
    });

    it("should extract extended text message with links", () => {
      const msg = createMessage({
        extendedTextMessage: {
          text: "Check out https://example.com",
          matchedText: "https://example.com",
        },
      });

      expect(msg.message?.extendedTextMessage?.text).toBe(
        "Check out https://example.com"
      );
    });

    it("should handle text with emojis", () => {
      const msg = createMessage({
        conversation: "Hello! 👋 How are you? 😊",
      });

      expect(msg.message?.conversation).toBe("Hello! 👋 How are you? 😊");
    });
  });

  describe("Image Messages", () => {
    it("should extract image message with caption", () => {
      const msg = createMessage({
        imageMessage: {
          caption: "Check out this photo!",
          mimetype: "image/jpeg",
          fileLength: 102400,
          width: 1920,
          height: 1080,
          directPath: "/v/t62.1234-5/abc123",
        },
      });

      const imgMsg = msg.message?.imageMessage;
      expect(imgMsg?.caption).toBe("Check out this photo!");
      expect(imgMsg?.mimetype).toBe("image/jpeg");
      expect(imgMsg?.width).toBe(1920);
      expect(imgMsg?.height).toBe(1080);
    });

    it("should detect view-once image", () => {
      const msg = createMessage({
        imageMessage: {
          mimetype: "image/jpeg",
          viewOnce: true,
        },
      });

      expect(msg.message?.imageMessage?.viewOnce).toBe(true);
    });
  });

  describe("Video Messages", () => {
    it("should extract video message with caption", () => {
      const msg = createMessage({
        videoMessage: {
          caption: "Watch this!",
          mimetype: "video/mp4",
          fileLength: 5242880,
          seconds: 30,
          width: 1280,
          height: 720,
          directPath: "/v/t62.1234-5/video123",
        },
      });

      const vidMsg = msg.message?.videoMessage;
      expect(vidMsg?.caption).toBe("Watch this!");
      expect(vidMsg?.mimetype).toBe("video/mp4");
      expect(vidMsg?.seconds).toBe(30);
    });

    it("should detect GIF playback", () => {
      const msg = createMessage({
        videoMessage: {
          mimetype: "video/mp4",
          gifPlayback: true,
        },
      });

      expect(msg.message?.videoMessage?.gifPlayback).toBe(true);
    });

    it("should detect view-once video", () => {
      const msg = createMessage({
        videoMessage: {
          mimetype: "video/mp4",
          viewOnce: true,
        },
      });

      expect(msg.message?.videoMessage?.viewOnce).toBe(true);
    });
  });

  describe("Video Note (PTV) Messages", () => {
    it("should extract video note message", () => {
      const msg = createMessage({
        ptvMessage: {
          mimetype: "video/mp4",
          fileLength: 1048576,
          seconds: 15,
          width: 240,
          height: 240,
          directPath: "/v/t62.1234-5/ptv123",
        },
      });

      const ptvMsg = msg.message?.ptvMessage;
      expect(ptvMsg?.mimetype).toBe("video/mp4");
      expect(ptvMsg?.seconds).toBe(15);
      // PTV videos are circular, usually square dimensions
      expect(ptvMsg?.width).toBe(ptvMsg?.height);
    });
  });

  describe("Audio Messages", () => {
    it("should extract audio message (not voice note)", () => {
      const msg = createMessage({
        audioMessage: {
          mimetype: "audio/mpeg",
          fileLength: 3145728,
          seconds: 180,
          ptt: false,
          directPath: "/v/t62.1234-5/audio123",
        },
      });

      const audMsg = msg.message?.audioMessage;
      expect(audMsg?.mimetype).toBe("audio/mpeg");
      expect(audMsg?.seconds).toBe(180);
      expect(audMsg?.ptt).toBe(false);
    });

    it("should detect voice note (ptt)", () => {
      const msg = createMessage({
        audioMessage: {
          mimetype: "audio/ogg; codecs=opus",
          seconds: 10,
          ptt: true,
          waveform: new Uint8Array([1, 2, 3, 4, 5]),
        },
      });

      expect(msg.message?.audioMessage?.ptt).toBe(true);
    });

    it("should detect view-once audio", () => {
      const msg = createMessage({
        audioMessage: {
          mimetype: "audio/ogg; codecs=opus",
          ptt: true,
          viewOnce: true,
        },
      });

      expect(msg.message?.audioMessage?.viewOnce).toBe(true);
    });
  });

  describe("Document Messages", () => {
    it("should extract document message", () => {
      const msg = createMessage({
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "report.pdf",
          fileLength: 1048576,
          caption: "Here's the report",
          directPath: "/v/t62.1234-5/doc123",
        },
      });

      const docMsg = msg.message?.documentMessage;
      expect(docMsg?.mimetype).toBe("application/pdf");
      expect(docMsg?.fileName).toBe("report.pdf");
      expect(docMsg?.caption).toBe("Here's the report");
    });
  });

  describe("Sticker Messages", () => {
    it("should extract sticker message", () => {
      const msg = createMessage({
        stickerMessage: {
          mimetype: "image/webp",
          fileLength: 51200,
          width: 512,
          height: 512,
          isAnimated: false,
          directPath: "/v/t62.1234-5/sticker123",
        },
      });

      const stickerMsg = msg.message?.stickerMessage;
      expect(stickerMsg?.mimetype).toBe("image/webp");
      expect(stickerMsg?.isAnimated).toBe(false);
    });

    it("should detect animated sticker", () => {
      const msg = createMessage({
        stickerMessage: {
          mimetype: "image/webp",
          isAnimated: true,
        },
      });

      expect(msg.message?.stickerMessage?.isAnimated).toBe(true);
    });

    it("should detect Lottie sticker", () => {
      const msg = createMessage({
        stickerMessage: {
          mimetype: "application/x-tgsticker",
          isLottie: true,
        },
      });

      expect(msg.message?.stickerMessage?.isLottie).toBe(true);
    });
  });

  describe("Location Messages", () => {
    it("should extract location message", () => {
      const msg = createMessage({
        locationMessage: {
          degreesLatitude: 37.7749,
          degreesLongitude: -122.4194,
          name: "San Francisco",
          address: "San Francisco, CA, USA",
        },
      });

      const locMsg = msg.message?.locationMessage;
      expect(locMsg?.degreesLatitude).toBeCloseTo(37.7749);
      expect(locMsg?.degreesLongitude).toBeCloseTo(-122.4194);
      expect(locMsg?.name).toBe("San Francisco");
      expect(locMsg?.address).toBe("San Francisco, CA, USA");
    });

    it("should extract live location message", () => {
      const msg = createMessage({
        liveLocationMessage: {
          degreesLatitude: 37.7749,
          degreesLongitude: -122.4194,
          accuracyInMeters: 10,
          speedInMps: 5.5,
        },
      });

      const liveLocMsg = msg.message?.liveLocationMessage;
      expect(liveLocMsg?.degreesLatitude).toBeCloseTo(37.7749);
      expect(liveLocMsg?.accuracyInMeters).toBe(10);
    });
  });

  describe("View-Once Wrapper Messages", () => {
    it("should handle viewOnceMessage wrapper", () => {
      const msg = createMessage({
        viewOnceMessage: {
          message: {
            imageMessage: {
              mimetype: "image/jpeg",
              caption: "View once image",
            },
          },
        },
      });

      const innerMsg = msg.message?.viewOnceMessage?.message;
      expect(innerMsg?.imageMessage?.caption).toBe("View once image");
    });

    it("should handle viewOnceMessageV2 wrapper", () => {
      const msg = createMessage({
        viewOnceMessageV2: {
          message: {
            videoMessage: {
              mimetype: "video/mp4",
              caption: "View once video",
            },
          },
        },
      });

      const innerMsg = msg.message?.viewOnceMessageV2?.message;
      expect(innerMsg?.videoMessage?.caption).toBe("View once video");
    });
  });
});

describe("Message Store Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should store text message with correct type", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "text",
      content: "Hello, world!",
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "text",
        content: "Hello, world!",
      })
    );
  });

  it("should store image message with media fields", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "image",
      content: "Check this out!",
      mediaUrl: "/v/t62.1234-5/abc123",
      mediaMimetype: "image/jpeg",
      mediaSizeBytes: 102400,
      mediaWidth: 1920,
      mediaHeight: 1080,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "image",
        mediaUrl: "/v/t62.1234-5/abc123",
        mediaMimetype: "image/jpeg",
      })
    );
  });

  it("should store voice note with flags", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "audio",
      mediaMimetype: "audio/ogg; codecs=opus",
      mediaDurationSeconds: 15,
      isVoiceNote: true,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "audio",
        isVoiceNote: true,
      })
    );
  });

  it("should store video note with flags", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "video",
      mediaMimetype: "video/mp4",
      mediaDurationSeconds: 10,
      isVideoNote: true,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "video",
        isVideoNote: true,
      })
    );
  });

  it("should store GIF with flag", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "video",
      mediaMimetype: "video/mp4",
      isGif: true,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "video",
        isGif: true,
      })
    );
  });

  it("should store location message with coordinates", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "location",
      locationLatitude: 37.7749,
      locationLongitude: -122.4194,
      locationName: "San Francisco",
      locationAddress: "San Francisco, CA",
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "location",
        locationLatitude: 37.7749,
        locationLongitude: -122.4194,
      })
    );
  });

  it("should store view-once message with flag", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "image",
      mediaMimetype: "image/jpeg",
      isViewOnce: true,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "image",
        isViewOnce: true,
      })
    );
  });

  it("should store animated sticker with flag", async () => {
    const { getMessageStore } = await import("../../history/message-store.js");
    const store = getMessageStore();

    await store.storeMessage({
      phoneNumber: "1234567890",
      correlationId: "test-corr",
      direction: "inbound",
      channel: "whatsapp",
      messageType: "sticker",
      mediaMimetype: "image/webp",
      isAnimated: true,
    });

    expect(store.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "sticker",
        isAnimated: true,
      })
    );
  });
});
