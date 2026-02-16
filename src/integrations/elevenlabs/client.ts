import type { ElevenLabsConfig } from "../../config/types.js";
import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";
import { spawn } from "child_process";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

export type VoiceStatus = "pending" | "processing" | "completed" | "failed";

export interface VoiceResult {
  audioData: Buffer | null;
  status: VoiceStatus;
  error?: string;
  contentType?: string;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
}

function getApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[elevenlabs] ${message}`);
}

/**
 * Convert MP3 buffer to OGG/Opus format for better WhatsApp compatibility
 * WhatsApp voice notes on Android require OGG/Opus format
 */
async function convertToOgg(mp3Buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",           // Read from stdin
      "-c:a", "libopus",        // Use Opus codec
      "-b:a", "64k",            // Bitrate
      "-vbr", "on",             // Variable bitrate
      "-compression_level", "10", // Highest compression
      "-application", "voip",   // Optimize for voice
      "-f", "ogg",              // Output format
      "pipe:1"                  // Write to stdout
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (data: Buffer) => {
      // ffmpeg logs to stderr, we can ignore most of it
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        log(`ffmpeg: ${msg}`);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });

    // Write MP3 data to ffmpeg stdin
    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();
  });
}

/**
 * Generate a voice message using ElevenLabs TTS
 * Returns audio data as a buffer that can be sent as a voice note
 */
export async function generateVoiceMessage(
  config: ElevenLabsConfig,
  text: string,
  recipientName?: string
): Promise<VoiceResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log("API key not configured (ELEVENLABS_API_KEY)");
    return { audioData: null, status: "failed", error: "API key not configured" };
  }

  const voiceId = config.voiceId;
  if (!voiceId) {
    log("Voice ID not configured");
    return { audioData: null, status: "failed", error: "Voice ID not configured" };
  }

  // Replace {name} placeholder in text if recipientName provided
  const processedText = recipientName
    ? text.replace(/\{name\}/g, recipientName)
    : text;

  try {
    const endTimer = startTimer();

    const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg", // Request MP3 format for WhatsApp compatibility
      },
      body: JSON.stringify({
        text: processedText,
        model_id: config.modelId ?? "eleven_monolingual_v1",
        voice_settings: {
          stability: config.stability ?? 0.5,
          similarity_boost: config.similarityBoost ?? 0.75,
          style: config.style ?? 0,
          use_speaker_boost: config.useSpeakerBoost ?? true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Voice generation failed: ${response.status} - ${errorText}`);
      recordIntegrationCall("elevenlabs", "text_to_speech", "failure", endTimer());
      return { audioData: null, status: "failed", error: errorText };
    }

    recordIntegrationCall("elevenlabs", "text_to_speech", "success", endTimer());

    const arrayBuffer = await response.arrayBuffer();
    const mp3Data = Buffer.from(arrayBuffer);

    log(`Voice message generated (MP3): ${mp3Data.length} bytes`);

    // Convert to OGG/Opus for WhatsApp Android compatibility
    let audioData: Buffer;
    let contentType: string;
    try {
      audioData = await convertToOgg(mp3Data);
      contentType = "audio/ogg; codecs=opus";
      log(`Converted to OGG/Opus: ${audioData.length} bytes`);
    } catch (conversionError) {
      log(`OGG conversion failed, using MP3: ${conversionError}`);
      audioData = mp3Data;
      contentType = "audio/mpeg";
    }

    return {
      audioData,
      status: "completed",
      contentType,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    return { audioData: null, status: "failed", error: message };
  }
}

/**
 * Generate voice message and save to file
 */
export async function generateVoiceFile(
  config: ElevenLabsConfig,
  text: string,
  outputPath: string,
  recipientName?: string
): Promise<VoiceResult & { filePath?: string }> {
  const result = await generateVoiceMessage(config, text, recipientName);

  if (result.status !== "completed" || !result.audioData) {
    return result;
  }

  try {
    const fs = await import("fs/promises");
    await fs.writeFile(outputPath, result.audioData);
    log(`Voice file saved: ${outputPath}`);
    return { ...result, filePath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { audioData: null, status: "failed", error: `Failed to save file: ${message}` };
  }
}

/**
 * List available voices
 */
export async function listVoices(): Promise<VoiceInfo[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("elevenlabs", "list_voices", "failure", endTimer());
      return [];
    }

    const data = (await response.json()) as {
      voices?: VoiceInfo[];
    };

    recordIntegrationCall("elevenlabs", "list_voices", "success", endTimer());
    return data.voices ?? [];
  } catch {
    recordIntegrationCall("elevenlabs", "list_voices", "failure", endTimer());
    return [];
  }
}

/**
 * Get specific voice details
 */
export async function getVoice(voiceId: string): Promise<VoiceInfo | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/voices/${voiceId}`, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("elevenlabs", "get_voice", "failure", endTimer());
      return null;
    }

    recordIntegrationCall("elevenlabs", "get_voice", "success", endTimer());
    return (await response.json()) as VoiceInfo;
  } catch {
    recordIntegrationCall("elevenlabs", "get_voice", "failure", endTimer());
    return null;
  }
}

/**
 * Get available models
 */
export async function listModels(): Promise<Array<{ model_id: string; name: string }>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/models`, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("elevenlabs", "list_models", "failure", endTimer());
      return [];
    }

    const models = (await response.json()) as Array<{ model_id: string; name: string }>;
    recordIntegrationCall("elevenlabs", "list_models", "success", endTimer());
    return models;
  } catch {
    recordIntegrationCall("elevenlabs", "list_models", "failure", endTimer());
    return [];
  }
}

/**
 * Get user subscription info (for checking quota)
 */
export async function getSubscriptionInfo(): Promise<{
  character_count: number;
  character_limit: number;
  remaining: number;
} | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const endTimer = startTimer();
  try {
    const response = await fetch(`${ELEVENLABS_API_BASE}/user/subscription`, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!response.ok) {
      recordIntegrationCall("elevenlabs", "get_subscription_info", "failure", endTimer());
      return null;
    }

    const data = (await response.json()) as {
      character_count: number;
      character_limit: number;
    };

    recordIntegrationCall("elevenlabs", "get_subscription_info", "success", endTimer());
    return {
      character_count: data.character_count,
      character_limit: data.character_limit,
      remaining: data.character_limit - data.character_count,
    };
  } catch {
    recordIntegrationCall("elevenlabs", "get_subscription_info", "failure", endTimer());
    return null;
  }
}
