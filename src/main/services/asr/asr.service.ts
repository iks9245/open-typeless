/**
 * ASR Service.
 * Manages the end-to-end ASR flow including WebSocket connection,
 * audio processing, and floating window display.
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import { WhisperClient } from './lib/whisper-client';
import type { SpeechLevel } from './lib/speech-level';
import { buildVocabularyPrompt } from '../../../shared/lib/vocabulary-prompt';
import { loadWhisperConfig } from './lib/config';
import { floatingWindow } from '../../windows';
import { settingsService } from '../settings';
import { whisperServerService } from '../whisper-server';
import type { ASRConfig, ASRResult, ASRStatus } from '../../../shared/types/asr';

const logger = log.scope('asr-service');

/** Longest wait for an app-managed whisper-server that is still loading its model */
const SERVER_STARTUP_WAIT_MS = 30000;

/** PCM bytes per millisecond for 16-bit, 16 kHz, mono audio. */
const PCM_BYTES_PER_MS = (16000 * 2) / 1000;

/**
 * Everything a stopped session produced, for callers that record history.
 */
export interface ASRSessionOutcome {
  /** Final (or last interim) result, or null if none arrived */
  result: ASRResult | null;
  /** Duration of the audio submitted for transcription */
  audioDurationMs: number;
  /** Time from stop request to result (or timeout) */
  latencyMs: number;
  /** Language reported by the engine; whisper.cpp JSON responses do not include it */
  detectedLanguage: string | null;
  /** Last client error during this session, if any */
  error: string | null;
  /** WAV sent to the engine, or null when no audio was submitted */
  wav: Buffer | null;
  /** Speech level of the recording, or null when nothing was recorded */
  speech: SpeechLevel | null;
  /** Why transcription was not requested ('silence'), or null when it was */
  skipped: 'silence' | null;
}

/**
 * Event types emitted by ASRService.
 */
export interface ASRServiceEvents {
  status: (status: ASRStatus) => void;
  result: (result: ASRResult) => void;
  error: (error: Error) => void;
}

/**
 * Type-safe event emitter interface for ASRService.
 */
export interface ASRService {
  on<K extends keyof ASRServiceEvents>(event: K, listener: ASRServiceEvents[K]): this;
  off<K extends keyof ASRServiceEvents>(event: K, listener: ASRServiceEvents[K]): this;
  emit<K extends keyof ASRServiceEvents>(
    event: K,
    ...args: Parameters<ASRServiceEvents[K]>
  ): boolean;
}

/**
 * ASR Service manages the complete ASR flow.
 *
 * State machine:
 * ```
 * idle → connecting → listening → processing → done
 *                         ↓
 *                       error
 * ```
 *
 * @example
 * ```typescript
 * // Start ASR
 * await asrService.start();
 *
 * // Send audio chunks
 * asrService.processAudioChunk(audioBuffer);
 *
 * // Stop and get result
 * const result = await asrService.stop();
 * ```
 */
export class ASRService extends EventEmitter {
  private client: WhisperClient | null = null;
  private status: ASRStatus = 'idle';
  private finalResult: ASRResult | null = null;
  private lastResult: ASRResult | null = null;
  private sessionError: string | null = null;

  /**
   * Get current ASR status.
   */
  get currentStatus(): ASRStatus {
    return this.status;
  }

  /**
   * Start ASR session.
   *
   * @param config - Optional partial configuration to override environment variables
   * @throws ConfigurationError if required credentials are missing
   * @throws Error if connection fails after retries
   */
  async start(config?: Partial<ASRConfig>): Promise<void> {
    if (this.status !== 'idle') {
      logger.warn('ASR session already active, stopping previous session');
      await this.stop();
    }

    logger.info('Starting ASR session');
    this.reset();

    // Load whisper.cpp config: settings (which default to env vars), then runtime overrides
    const whisperConfig = loadWhisperConfig();
    const settings = settingsService.get();
    if (settings.success) {
      whisperConfig.serverUrl = settings.data.asr.whisperServerUrl;
      whisperConfig.language = settings.data.asr.language ?? undefined;
      whisperConfig.prompt = buildVocabularyPrompt(settings.data.asr.vocabulary) ?? undefined;
    }
    if (config?.serverUrl) whisperConfig.serverUrl = config.serverUrl;
    if (config?.language) whisperConfig.language = config.language;

    this.client = new WhisperClient(whisperConfig);

    // Setup event forwarding
    this.setupClientListeners();

    // Show floating window and update status
    this.updateStatus('connecting');

    // The app-managed server may still be loading its model: wait rather than fail
    if (whisperServerService.status().state === 'starting') {
      logger.info('Waiting for whisper-server to finish starting');
      const ready = await whisperServerService.waitUntilReady(SERVER_STARTUP_WAIT_MS);
      if (!ready) {
        logger.warn('whisper-server is not ready; connecting anyway', {
          status: whisperServerService.status(),
        });
      }
    }

    // Verify whisper.cpp server is reachable
    try {
      await this.client.connect();
      logger.info('ASR session started successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to connect to whisper.cpp server', { error: err.message });
      this.updateStatus('error');
      this.emit('error', err);
      floatingWindow.sendError(`Connection failed: ${err.message}`);
      this.cleanup();
      throw err;
    }
  }

  /**
   * Stop ASR session.
   *
   * @returns The final ASR result, or null if no result was received
   */
  async stop(): Promise<ASRResult | null> {
    return (await this.stopWithOutcome()).result;
  }

  /**
   * Stop ASR session and report what it produced.
   *
   * @returns The result together with audio duration, latency, error and submitted WAV
   */
  async stopWithOutcome(): Promise<ASRSessionOutcome> {
    const startedAt = Date.now();

    if (!this.client || this.status === 'idle') {
      logger.warn('No active ASR session to stop');
      return this.buildOutcome(null, startedAt);
    }

    logger.info('Stopping ASR session');

    // Signal end of audio to get final result
    if (this.client.isConnected) {
      this.client.finishAudio();

      // Wait for final result with timeout
      const result = await this.waitForFinalResult();
      // Read submitted audio before cleanup() disconnects the client and clears it
      const outcome = this.buildOutcome(result, startedAt);
      this.cleanup();
      return outcome;
    }

    const outcome = this.buildOutcome(this.finalResult, startedAt);
    this.cleanup();
    return outcome;
  }

  /**
   * Abandon the active session without transcribing it.
   * Buffered audio is discarded and nothing is sent to the engine; status returns to idle.
   * Call after start() has settled, as with stop().
   */
  cancel(): void {
    if (!this.client || this.status === 'idle') {
      logger.debug('No active ASR session to cancel');
      return;
    }

    logger.info('Cancelling ASR session');
    this.cleanup();
  }

  /**
   * Process an audio chunk.
   * The chunk should be PCM 16-bit, 16kHz, mono format.
   *
   * @param chunk - Audio data as ArrayBuffer
   */
  processAudioChunk(chunk: ArrayBuffer): void {
    if (!this.client || !this.client.isConnected) {
      logger.warn('Cannot process audio: no active connection');
      return;
    }

    if (this.status !== 'listening') {
      logger.warn('Cannot process audio: not in listening state', { status: this.status });
      return;
    }

    this.client.sendAudio(chunk);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Reset service state for a new session.
   */
  private reset(): void {
    this.finalResult = null;
    this.lastResult = null;
    this.sessionError = null;
    this.status = 'idle';
  }

  /**
   * Assemble the session outcome from the current client state.
   */
  private buildOutcome(result: ASRResult | null, startedAt: number): ASRSessionOutcome {
    const audio = this.client?.submittedAudio ?? { pcmBytes: 0, wav: null, speech: null, skipped: null };
    return {
      result,
      audioDurationMs: Math.round(audio.pcmBytes / PCM_BYTES_PER_MS),
      latencyMs: Date.now() - startedAt,
      detectedLanguage: null,
      error: this.sessionError,
      wav: audio.wav,
      speech: audio.speech,
      skipped: audio.skipped,
    };
  }

  /**
   * Update status and emit event.
   */
  private updateStatus(status: ASRStatus): void {
    this.status = status;
    this.emit('status', status);
    floatingWindow.sendStatus(status);
    logger.debug('Status updated', { status });
  }

  /**
   * Setup event listeners on the Volcengine client.
   */
  private setupClientListeners(): void {
    if (!this.client) return;

    this.client.on('status', (status) => {
      this.updateStatus(status);
    });

    this.client.on('result', (result) => {
      this.lastResult = result;

      if (result.isFinal) {
        this.finalResult = result;
      }

      this.emit('result', result);
      floatingWindow.sendResult(result);
    });

    this.client.on('error', (error) => {
      logger.error('Whisper client error', { message: error.message });
      this.sessionError = error.message;
      this.updateStatus('error');
      this.emit('error', error);
      floatingWindow.sendError(error.message);
    });
  }

  /**
   * Wait for the final result, a client error, or a timeout.
   * Resolves with the final (or last interim) result; null when none arrived.
   */
  private waitForFinalResult(): Promise<ASRResult | null> {
    return new Promise((resolve) => {
      // If we already have a final result, return it
      if (this.finalResult) {
        resolve(this.finalResult);
        return;
      }

      const TIMEOUT_MS = 10000; // 10 seconds timeout
      const client = this.client;
      let resolved = false;
      let doneTimeoutId: NodeJS.Timeout | null = null;

      const finish = (result: ASRResult | null): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        if (doneTimeoutId) clearTimeout(doneTimeoutId);
        client?.off('result', resultHandler);
        client?.off('status', statusHandler);
        client?.off('error', errorHandler);
        resolve(result);
      };

      const resultHandler = (result: ASRResult): void => {
        if (result.isFinal) {
          finish(result);
        }
      };

      const statusHandler = (status: ASRStatus): void => {
        if (status === 'done' && !doneTimeoutId) {
          // Give a small delay for the final result to come through
          doneTimeoutId = setTimeout(() => finish(this.finalResult ?? this.lastResult), 500);
        } else if (status === 'error') {
          finish(this.finalResult ?? this.lastResult);
        }
      };

      // Transcription failed: no final result will follow, so stop waiting.
      // sessionError is captured by the listener registered in setupClientListeners().
      const errorHandler = (): void => {
        finish(this.finalResult ?? this.lastResult);
      };

      const timeoutId = setTimeout(() => {
        logger.warn('Timeout waiting for final result, returning last result');
        // Return last result or final result, whichever is available
        finish(this.finalResult ?? this.lastResult);
      }, TIMEOUT_MS);

      client?.on('result', resultHandler);
      client?.on('status', statusHandler);
      client?.on('error', errorHandler);
    });
  }

  /**
   * Cleanup resources.
   */
  private cleanup(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.disconnect();
      this.client = null;
    }

    if (this.status === 'error') {
      // Leave the error on screen; the floating window auto-hides it after sendError()
      this.status = 'idle';
      this.emit('status', 'idle');
      logger.debug('Status updated', { status: 'idle' });
    } else {
      this.updateStatus('idle');
    }
    logger.info('ASR session cleaned up');
  }
}

/**
 * Singleton instance of the ASR service.
 */
export const asrService = new ASRService();
