/**
 * Whisper.cpp ASR Client
 * Buffers PCM audio locally, then sends a WAV file to a whisper.cpp HTTP server
 * on finishAudio(). Returns a single final result — no streaming interim results.
 *
 * Expected whisper.cpp server: https://github.com/ggerganov/whisper.cpp
 * Run with: ./server -m models/ggml-base.bin -l zh
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import type { ASRResult, ASRStatus } from '../../../../shared/types/asr';
import type { ConnectionState } from '../types';

const logger = log.scope('whisper-client');

export interface WhisperClientConfig {
  serverUrl: string;
  language?: string; // e.g. "zh", "en" — undefined means auto-detect
}

// Build a minimal WAV header around raw PCM (16-bit, 16 kHz, mono)
function buildWAV(pcmData: Buffer): Buffer {
  const numChannels = 1;
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export interface WhisperClientEvents {
  result: (result: ASRResult) => void;
  status: (status: ASRStatus) => void;
  error: (error: Error) => void;
}

export interface WhisperClient {
  on<K extends keyof WhisperClientEvents>(event: K, listener: WhisperClientEvents[K]): this;
  off<K extends keyof WhisperClientEvents>(event: K, listener: WhisperClientEvents[K]): this;
  emit<K extends keyof WhisperClientEvents>(
    event: K,
    ...args: Parameters<WhisperClientEvents[K]>
  ): boolean;
}

export class WhisperClient extends EventEmitter {
  private readonly config: WhisperClientConfig;
  private connectionState: ConnectionState = 'disconnected';
  private audioChunks: Buffer[] = [];

  constructor(config: WhisperClientConfig) {
    super();
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    this.audioChunks = [];
    this.updateState('connecting');
    this.emitStatus('connecting');

    logger.info('Checking whisper.cpp server', { url: this.config.serverUrl });

    try {
      // Any HTTP response means the server is reachable; connection refused = not running
      const response = await fetch(`${this.config.serverUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() =>
        // Some whisper.cpp builds don't have /health — fall back to root
        fetch(this.config.serverUrl, { signal: AbortSignal.timeout(5000) }),
      );

      logger.info('whisper.cpp server reachable', { status: response.status });
    } catch (error) {
      const err = new Error(
        `Cannot reach whisper.cpp server at ${this.config.serverUrl}. ` +
          `Make sure the server is running.`,
      );
      logger.error('Failed to reach whisper.cpp server', { error: (error as Error).message });
      this.updateState('error');
      this.emitStatus('error');
      this.emit('error', err);
      throw err;
    }

    this.updateState('connected');
    this.emitStatus('listening');
    logger.info('Ready — whisper.cpp server is up');
  }

  disconnect(): void {
    this.audioChunks = [];
    this.updateState('disconnected');
    this.emitStatus('idle');
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.isConnected) {
      logger.warn('Cannot send audio: not connected');
      return;
    }
    this.audioChunks.push(Buffer.from(chunk));
  }

  // Starts transcription asynchronously — caller listens for 'result' / 'error' events
  finishAudio(): void {
    if (!this.isConnected) {
      logger.warn('Cannot finish audio: not connected');
      return;
    }

    this.emitStatus('processing');

    this.transcribe().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Transcription error', { error: err.message });
      this.emit('error', err);
      this.emitStatus('error');
    });
  }

  private async transcribe(): Promise<void> {
    const pcmData = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    if (pcmData.length === 0) {
      logger.warn('No audio data to transcribe');
      this.emitStatus('done');
      return;
    }

    logger.info('Sending audio to whisper.cpp', { bytes: pcmData.length });

    const wavData = buildWAV(pcmData);
    const formData = new FormData();
    formData.append('file', new Blob([wavData], { type: 'audio/wav' }), 'audio.wav');
    formData.append('response_format', 'json');
    if (this.config.language) {
      formData.append('language', this.config.language);
    }

    const response = await fetch(`${this.config.serverUrl}/inference`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Inference failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { text?: string };
    const text = (data.text ?? '').trim();

    logger.info('Transcription done', { textLength: text.length });

    this.emit('result', { type: 'final', text, isFinal: true } satisfies ASRResult);
    this.emitStatus('done');
  }

  private updateState(state: ConnectionState): void {
    this.connectionState = state;
  }

  private emitStatus(status: ASRStatus): void {
    this.emit('status', status);
  }
}
