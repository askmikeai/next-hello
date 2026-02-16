/**
 * OpenAI Whisper API Client
 *
 * Transcribes audio files to text using OpenAI's Whisper model.
 * Used for processing incoming voice messages from WhatsApp.
 */

import { recordIntegrationCall, startTimer } from "../../observability/metrics.js";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "whisper-1";
const TRANSCRIPTION_TIMEOUT_MS = 30000;

export interface TranscriptionResult {
  text: string;
  status: "completed" | "failed";
  error?: string;
  durationSeconds?: number;
  language?: string;
}

export interface TranscriptionOptions {
  /** Language hint (ISO-639-1 code) */
  language?: string;
  /** Prompt to guide the model's transcription */
  prompt?: string;
  /** Temperature for sampling (0-1) */
  temperature?: number;
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

function log(message: string): void {
  console.log(`[whisper] ${message}`);
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "audio/flac": "flac",
  };

  // Handle mime types with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMimeType = mimeType.split(";")[0].trim();
  return mimeToExt[mimeType] || mimeToExt[baseMimeType] || "ogg";
}

/**
 * Transcribe audio using OpenAI Whisper API
 *
 * Supports formats: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg
 * WhatsApp voice notes are typically OGG/Opus format.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  options?: TranscriptionOptions
): Promise<TranscriptionResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log("API key not configured (OPENAI_API_KEY)");
    return {
      text: "",
      status: "failed",
      error: "API key not configured",
    };
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    log("Empty audio buffer provided");
    return {
      text: "",
      status: "failed",
      error: "Empty audio buffer",
    };
  }

  const endTimer = startTimer();
  const extension = getExtensionFromMimeType(mimeType);

  try {
    // Create form data for multipart upload
    const formData = new FormData();

    // Create a Blob from the buffer with the correct MIME type
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length);
    const blob = new Blob([uint8Array], { type: mimeType });
    formData.append("file", blob, `audio.${extension}`);
    formData.append("model", DEFAULT_MODEL);

    // Optional parameters
    if (options?.language) {
      formData.append("language", options.language);
    }
    if (options?.prompt) {
      formData.append("prompt", options.prompt);
    }
    if (options?.temperature !== undefined) {
      formData.append("temperature", options.temperature.toString());
    }

    // Request verbose JSON response to get duration and language
    formData.append("response_format", "verbose_json");

    log(`Transcribing ${(audioBuffer.length / 1024).toFixed(2)} KB of ${mimeType} audio`);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);

    const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log(`Transcription failed: ${response.status} - ${errorText}`);
      recordIntegrationCall("openai", "whisper_transcription", "failure", endTimer());
      return {
        text: "",
        status: "failed",
        error: `API error ${response.status}: ${errorText}`,
      };
    }

    const result = (await response.json()) as {
      text: string;
      language?: string;
      duration?: number;
    };

    const durationMs = endTimer();
    recordIntegrationCall("openai", "whisper_transcription", "success", durationMs);

    log(
      `Transcription completed in ${durationMs}ms: "${result.text.substring(0, 50)}${result.text.length > 50 ? "..." : ""}"`
    );

    return {
      text: result.text.trim(),
      status: "completed",
      durationSeconds: result.duration,
      language: result.language,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      log(`Transcription timed out after ${TRANSCRIPTION_TIMEOUT_MS}ms`);
      recordIntegrationCall("openai", "whisper_transcription", "failure", endTimer());
      return {
        text: "",
        status: "failed",
        error: "Transcription timed out",
      };
    }

    log(`Transcription error: ${message}`);
    recordIntegrationCall("openai", "whisper_transcription", "failure", endTimer());
    return {
      text: "",
      status: "failed",
      error: message,
    };
  }
}

/**
 * Check if a MIME type is supported for transcription
 */
export function isSupportedAudioFormat(mimeType: string): boolean {
  const supportedTypes = [
    "audio/ogg",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/wav",
    "audio/wave",
    "audio/webm",
    "audio/flac",
  ];

  const baseMimeType = mimeType.split(";")[0].trim();
  return supportedTypes.includes(baseMimeType);
}

/**
 * Get the maximum supported audio duration in seconds
 * Whisper supports up to 25MB files, approximately 150 minutes for MP3
 */
export function getMaxSupportedDuration(): number {
  return 300; // 5 minutes as a reasonable default limit
}
