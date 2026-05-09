/**
 * ASR (Automatic Speech Recognition) type definitions.
 * Used by both main process and renderer process.
 */

/**
 * Runtime ASR configuration overrides (whisper.cpp backend).
 * All fields are optional — defaults come from environment variables.
 */
export interface ASRConfig {
  serverUrl?: string; // default: WHISPER_SERVER_URL or "http://localhost:8080"
  language?: string;  // e.g. "zh", "en" — default: WHISPER_LANGUAGE or auto-detect
}

/**
 * ASR result from speech recognition.
 */
export interface ASRResult {
  type: 'interim' | 'final';
  text: string;
  isFinal: boolean;
}

/**
 * ASR status states.
 * - idle: Not started
 * - connecting: Establishing connection to ASR service
 * - listening: Actively listening for audio
 * - processing: Processing final audio
 * - done: Recognition complete
 * - error: An error occurred
 */
export type ASRStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'done'
  | 'error';

/**
 * Audio chunk data (PCM format).
 */
export interface AudioChunk {
  data: Int16Array;
  sampleRate: 16000;
  channels: 1;
}
