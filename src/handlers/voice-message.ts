/**
 * Voice Message Handler
 *
 * Processes incoming voice messages by:
 * 1. Retrieving audio from MediaStore
 * 2. Transcribing via OpenAI Whisper
 * 3. Returning text for further processing
 */

import type { NetworkingEventConfig } from "../config/types.js";
import { getMediaStore } from "../storage/media-store.js";
import {
  transcribeAudio,
  isSupportedAudioFormat,
  getMaxSupportedDuration,
} from "../integrations/openai/index.js";
import { createLogger } from "../observability/logger.js";

export interface VoiceMessageParams {
  phoneNumber: string;
  mediaStorageKey: string;
  mediaMimetype: string;
  durationSeconds?: number;
  config: NetworkingEventConfig;
  correlationId: string;
}

export interface VoiceMessageResult {
  success: boolean;
  transcription?: string;
  error?: string;
  durationSeconds?: number;
  language?: string;
}

/**
 * Process a voice message and return the transcribed text
 */
export async function processVoiceMessage(
  params: VoiceMessageParams
): Promise<VoiceMessageResult> {
  const logger = createLogger({
    component: "voice-message",
    correlationId: params.correlationId,
    phoneNumber: params.phoneNumber,
  });

  logger.info({
    msg: "Processing voice message",
    storageKey: params.mediaStorageKey,
    mimetype: params.mediaMimetype,
    durationSeconds: params.durationSeconds,
  });

  // Check if transcription is enabled
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    logger.warn({ msg: "Voice transcription skipped - OPENAI_API_KEY not configured" });
    return {
      success: false,
      error: "Voice transcription not configured",
    };
  }

  // Check if audio format is supported
  if (!isSupportedAudioFormat(params.mediaMimetype)) {
    logger.warn({
      msg: "Unsupported audio format",
      mimetype: params.mediaMimetype,
    });
    return {
      success: false,
      error: `Unsupported audio format: ${params.mediaMimetype}`,
    };
  }

  // Check duration limit
  const maxDuration = getMaxSupportedDuration();
  if (params.durationSeconds && params.durationSeconds > maxDuration) {
    logger.warn({
      msg: "Voice message too long",
      duration: params.durationSeconds,
      maxDuration,
    });
    return {
      success: false,
      error: `Voice message too long (${params.durationSeconds}s > ${maxDuration}s)`,
    };
  }

  // Retrieve audio from MediaStore
  const mediaStore = getMediaStore();
  const audioBuffer = await mediaStore.get(params.mediaStorageKey);

  if (!audioBuffer) {
    logger.error({
      msg: "Failed to retrieve audio from storage",
      storageKey: params.mediaStorageKey,
    });
    return {
      success: false,
      error: "Failed to retrieve audio from storage",
    };
  }

  logger.debug({
    msg: "Retrieved audio from storage",
    sizeBytes: audioBuffer.length,
  });

  // Transcribe using Whisper
  const transcriptionResult = await transcribeAudio(
    audioBuffer,
    params.mediaMimetype,
    {
      // No language hint - let Whisper auto-detect
    }
  );

  if (transcriptionResult.status === "failed") {
    logger.error({
      msg: "Transcription failed",
      error: transcriptionResult.error,
    });
    return {
      success: false,
      error: transcriptionResult.error || "Transcription failed",
    };
  }

  // Handle empty transcription (silence, unintelligible audio)
  if (!transcriptionResult.text || transcriptionResult.text.trim() === "") {
    logger.warn({ msg: "Voice message transcribed to empty text" });
    return {
      success: true,
      transcription: "[Voice message - no speech detected]",
      durationSeconds: transcriptionResult.durationSeconds,
      language: transcriptionResult.language,
    };
  }

  logger.info({
    msg: "Voice message transcribed",
    textLength: transcriptionResult.text.length,
    durationSeconds: transcriptionResult.durationSeconds,
    language: transcriptionResult.language,
  });

  return {
    success: true,
    transcription: transcriptionResult.text,
    durationSeconds: transcriptionResult.durationSeconds,
    language: transcriptionResult.language,
  };
}

/**
 * Check if voice message processing is enabled
 */
export function isVoiceProcessingEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
