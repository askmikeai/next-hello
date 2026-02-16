/**
 * OpenAI Integration Module
 *
 * Exports Whisper API client for speech-to-text transcription.
 */

export {
  transcribeAudio,
  isSupportedAudioFormat,
  getMaxSupportedDuration,
  type TranscriptionResult,
  type TranscriptionOptions,
} from "./whisper.js";
