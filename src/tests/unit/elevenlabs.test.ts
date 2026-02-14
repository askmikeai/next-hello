/**
 * ElevenLabs Client Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock child_process spawn for ffmpeg
vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require("events");
    const mockProcess = new EventEmitter();
    mockProcess.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();

    // Simulate successful OGG conversion
    setTimeout(() => {
      const oggHeader = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // OGG magic bytes
      const fakeOggData = Buffer.concat([oggHeader, Buffer.alloc(100)]);
      mockProcess.stdout.emit("data", fakeOggData);
      mockProcess.emit("close", 0);
    }, 10);

    return mockProcess;
  }),
}));

describe("ElevenLabs Client", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    process.env.ELEVENLABS_API_KEY = "test-api-key";
  });

  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
  });

  describe("generateVoiceMessage", () => {
    it("should return error when API key is not configured", async () => {
      delete process.env.ELEVENLABS_API_KEY;

      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await generateVoiceMessage(
        { voiceId: "test-voice" },
        "Hello world"
      );

      expect(result.status).toBe("failed");
      expect(result.error).toContain("API key not configured");
      expect(result.audioData).toBeNull();
    });

    it("should return error when voice ID is not configured", async () => {
      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await generateVoiceMessage({} as any, "Hello world");

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Voice ID not configured");
    });

    it("should replace {name} placeholder in text", async () => {
      const mockMp3 = Buffer.alloc(1000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockMp3),
        headers: new Map([["content-type", "audio/mpeg"]]),
      });

      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      await generateVoiceMessage(
        { voiceId: "test-voice" },
        "Hey {name}! How are you?",
        "John"
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.text).toBe("Hey John! How are you?");
    });

    it("should convert MP3 to OGG format for WhatsApp compatibility", async () => {
      const mockMp3 = Buffer.alloc(1000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockMp3),
        headers: new Map([["content-type", "audio/mpeg"]]),
      });

      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await generateVoiceMessage(
        { voiceId: "test-voice" },
        "Test message"
      );

      expect(result.status).toBe("completed");
      expect(result.contentType).toBe("audio/ogg; codecs=opus");
      expect(result.audioData).not.toBeNull();
      // OGG files start with "OggS" magic bytes
      expect(result.audioData?.slice(0, 4).toString()).toBe("OggS");
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await generateVoiceMessage(
        { voiceId: "test-voice" },
        "Test message"
      );

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Unauthorized");
    });

    it("should use correct voice settings from config", async () => {
      const mockMp3 = Buffer.alloc(1000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockMp3),
        headers: new Map([["content-type", "audio/mpeg"]]),
      });

      const { generateVoiceMessage } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      await generateVoiceMessage(
        {
          voiceId: "test-voice",
          modelId: "eleven_multilingual_v2",
          stability: 0.7,
          similarityBoost: 0.8,
          style: 0.5,
          useSpeakerBoost: false,
        },
        "Test message"
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model_id).toBe("eleven_multilingual_v2");
      expect(callBody.voice_settings.stability).toBe(0.7);
      expect(callBody.voice_settings.similarity_boost).toBe(0.8);
      expect(callBody.voice_settings.style).toBe(0.5);
      expect(callBody.voice_settings.use_speaker_boost).toBe(false);
    });
  });

  describe("listVoices", () => {
    it("should return empty array when API key is not configured", async () => {
      delete process.env.ELEVENLABS_API_KEY;

      const { listVoices } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await listVoices();
      expect(result).toEqual([]);
    });

    it("should return list of voices", async () => {
      const mockVoices = {
        voices: [
          { voice_id: "v1", name: "Voice 1", category: "premade" },
          { voice_id: "v2", name: "Voice 2", category: "cloned" },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVoices),
      });

      const { listVoices } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await listVoices();
      expect(result).toHaveLength(2);
      expect(result[0].voice_id).toBe("v1");
    });
  });

  describe("getSubscriptionInfo", () => {
    it("should return character usage info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            character_count: 5000,
            character_limit: 10000,
          }),
      });

      const { getSubscriptionInfo } = await import(
        "../../integrations/elevenlabs/client.js"
      );

      const result = await getSubscriptionInfo();
      expect(result?.character_count).toBe(5000);
      expect(result?.character_limit).toBe(10000);
      expect(result?.remaining).toBe(5000);
    });
  });
});
