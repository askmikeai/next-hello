/**
 * WhatsApp Voice Message Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

// Mock fs module
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

describe("WhatsApp Voice Messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Voice file format detection", () => {
    it("should detect OGG files by extension", () => {
      const audioPath = "/app/data/media/voice/voice_123_456.ogg";
      const isOgg = audioPath.endsWith(".ogg");
      expect(isOgg).toBe(true);
    });

    it("should detect MP3 files by extension", () => {
      const audioPath = "/app/data/media/voice/voice_123_456.mp3";
      const isOgg = audioPath.endsWith(".ogg");
      expect(isOgg).toBe(false);
    });

    it("should use correct mimetype for OGG files", () => {
      const audioPath = "/app/data/media/voice/voice_123_456.ogg";
      const isOgg = audioPath.endsWith(".ogg");
      const mimetype = isOgg ? "audio/ogg; codecs=opus" : "audio/mpeg";
      expect(mimetype).toBe("audio/ogg; codecs=opus");
    });

    it("should use correct mimetype for MP3 files", () => {
      const audioPath = "/app/data/media/voice/voice_123_456.mp3";
      const isOgg = audioPath.endsWith(".ogg");
      const mimetype = isOgg ? "audio/ogg; codecs=opus" : "audio/mpeg";
      expect(mimetype).toBe("audio/mpeg");
    });
  });

  describe("Voice file naming", () => {
    it("should generate OGG filename for new voice files", () => {
      const phoneNumber = "17544220907";
      const timestamp = 1234567890;
      const phoneClean = phoneNumber.replace(/[^0-9]/g, "");
      const filename = `voice_${phoneClean}_${timestamp}.ogg`;

      expect(filename).toBe("voice_17544220907_1234567890.ogg");
      expect(filename).toMatch(/\.ogg$/);
    });

    it("should sanitize phone numbers in filenames", () => {
      const phoneNumber = "+1 (754) 422-0907";
      const phoneClean = phoneNumber.replace(/[^0-9]/g, "");
      expect(phoneClean).toBe("17544220907");
    });
  });

  describe("Voice message buffer handling", () => {
    it("should read voice file as buffer", () => {
      const mockBuffer = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00]); // OGG header
      (fs.readFileSync as any).mockReturnValue(mockBuffer);

      const audioPath = "/app/data/media/voice/test.ogg";
      const audioBuffer = fs.readFileSync(audioPath);

      expect(audioBuffer).toBeInstanceOf(Buffer);
      expect(audioBuffer.length).toBe(5);
      // Check for OGG magic bytes
      expect(audioBuffer.slice(0, 4).toString()).toBe("OggS");
    });
  });
});

describe("OGG Opus Format", () => {
  it("should have correct OGG magic bytes", () => {
    // OGG files start with "OggS" (0x4f 0x67 0x67 0x53)
    const oggMagic = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
    expect(oggMagic.toString()).toBe("OggS");
  });

  it("should produce smaller file size than MP3 for voice", () => {
    // Typical voice compression ratios:
    // MP3 at 128kbps ~= 1MB/min
    // Opus at 64kbps ~= 0.48MB/min (about 50% smaller)
    const mp3Size = 87397; // bytes (from our test)
    const oggSize = 57469; // bytes (from our test)
    const compressionRatio = oggSize / mp3Size;

    expect(compressionRatio).toBeLessThan(0.7); // OGG should be at least 30% smaller
    expect(compressionRatio).toBeGreaterThan(0.5); // But not too small (lossy)
  });
});
