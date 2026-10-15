/**
 * Push-to-Talk Service.
 * Orchestrates keyboard hooks, ASR, and text insertion for voice input.
 *
 * Flow:
 * 1. User holds the trigger key
 * 2. KeyboardService detects keydown -> triggers handleKeyDown
 * 3. ASR session starts, floating window shows
 * 4. Renderer starts recording, sends audio chunks
 * 5. User releases the trigger key
 * 6. KeyboardService detects keyup -> triggers handleKeyUp
 * 7. ASR session stops, gets final result
 * 8. Text is inserted at cursor position
 * 9. Floating window hides
 *
 * A short press or another key during the hold cancels instead (handleCancel):
 * nothing is transcribed or inserted, and the session's history row is removed.
 */

import { app, BrowserWindow, dialog } from 'electron';
import type { MessageBoxOptions } from 'electron';
import log from 'electron-log';
import { keyboardService } from '../keyboard';
import { textInputService } from '../text-input';
import { asrService } from '../asr';
import type { ASRSessionOutcome } from '../asr';
import { historyService } from '../history';
import { commandService } from '../command';
import { DEFAULT_COMMAND_MODEL, type InputMode } from '../../../shared/constants/command';
import { polishService } from '../polish';
import { settingsService } from '../settings';
import { permissionsService } from '../permissions';
import { floatingWindow } from '../../windows';
import { getTrustedWebContents } from '../../ipc/sender';
import { TRIGGER_KEYS } from '../../../shared/constants/keyboard';
import type { AppSettings } from '../../../shared/types/settings';
import { IPC_CHANNELS } from '../../../shared/constants/channels';

const logger = log.scope('push-to-talk-service');

/** How often to re-check Accessibility while waiting for the user to grant it */
const ACCESSIBILITY_POLL_MS = 2000;

/**
 * Push-to-Talk Service configuration.
 */
export interface PushToTalkConfig {
  /** Whether to auto-insert text after recognition */
  autoInsertText: boolean;
  /** Delay before hiding floating window after done (ms) */
  hideDelayMs: number;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: PushToTalkConfig = {
  autoInsertText: true,
  hideDelayMs: 500,
};

/**
 * Push-to-Talk Service orchestrates the voice input flow.
 *
 * Coordinates:
 * - KeyboardService: Global keyboard hook for trigger key
 * - ASRService: Speech recognition
 * - TextInputService: Text insertion at cursor
 * - FloatingWindow: Visual feedback
 *
 * @example
 * ```typescript
 * // Initialize on app ready
 * pushToTalkService.initialize();
 *
 * // Cleanup on app quit
 * pushToTalkService.dispose();
 * ```
 */
export class PushToTalkService {
  private config: PushToTalkConfig;
  private isActive = false;
  private finishing = false;
  private mode: InputMode = 'dictation';
  private commandModel = DEFAULT_COMMAND_MODEL;
  private isInitialized = false;
  /** History row of the active session; null when history is off or unavailable */
  private historyId: string | null = null;
  /** ASR start of the active session while it is still connecting */
  private starting: Promise<void> | null = null;
  /** Polls for Accessibility trust; null when not waiting for it */
  private accessibilityPoll: NodeJS.Timeout | null = null;
  private readonly onAppActivated = (): void => {
    this.tryStartKeyboardHook();
  };

  private readonly onSettingsChanged = (settings: AppSettings): void => {
    const key = TRIGGER_KEYS.find(key => key.id === settings.input.triggerKey) ?? TRIGGER_KEYS[0];
    keyboardService.setTriggerKey(key.keycode);
  };

  constructor(config: Partial<PushToTalkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the Push-to-Talk service.
   * Registers keyboard hooks and sets up event listeners.
   */
  initialize(): void {
    if (this.isInitialized) {
      logger.warn('PushToTalkService already initialized');
      return;
    }

    logger.info('Initializing PushToTalkService');
    const settings = settingsService.get();
    keyboardService.setTriggerKey(TRIGGER_KEYS[0].keycode);
    if (settings.success === true) this.onSettingsChanged(settings.data);
    settingsService.on('changed', this.onSettingsChanged);

    // Log permission status for debugging
    permissionsService.logPermissionStatus();

    // Ask macOS for microphone access up front. Without it the status stays
    // 'not-determined' and the renderer's getUserMedia captures silence, which
    // whisper.cpp transcribes as phantom text such as "Thank you."
    void permissionsService.requestMicrophonePermission().then((granted) => {
      if (granted) {
        logger.info('Microphone access granted');
      } else {
        logger.warn('Microphone access not granted: recordings will be silent until it is allowed');
      }
    });

    // The hook must not start without Accessibility (see KeyboardService.register);
    // wait for the grant instead so the app keeps running
    if (permissionsService.getAccessibilityStatus()) {
      this.tryStartKeyboardHook();
    } else {
      this.waitForAccessibility();
    }

    this.isInitialized = true;
    logger.info('PushToTalkService initialized');
  }

  /**
   * Dispose of the Push-to-Talk service.
   * Unregisters keyboard hooks and cleans up resources.
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    logger.info('Disposing PushToTalkService');

    // Stop any active session
    if (this.isActive) {
      this.handleKeyUp().catch((error) => {
        logger.error('Error during dispose cleanup', { error });
      });
    }

    // Unregister keyboard hooks
    this.stopWaitingForAccessibility();
    keyboardService.unregister();
    settingsService.off('changed', this.onSettingsChanged);

    this.isInitialized = false;
    logger.info('PushToTalkService disposed');
  }

  /**
   * Start the keyboard hook if Accessibility is trusted.
   * Stops waiting once the hook starts, or when it fails for another reason
   * (retrying a failed native start is not safe).
   *
   * @returns true if the hook is running
   */
  private tryStartKeyboardHook(): boolean {
    if (keyboardService.isActive) {
      return true;
    }

    if (!permissionsService.getAccessibilityStatus()) {
      return false;
    }

    const started = keyboardService.register(
      mode => this.handleKeyDown(mode),
      () => this.handleKeyUp(),
      (durationMs) => this.handleCancel(durationMs)
    );

    if (this.accessibilityPoll) {
      this.stopWaitingForAccessibility();
      logger.info(started
        ? 'Accessibility granted, push-to-talk enabled'
        : 'Accessibility granted but keyboard hook failed to start');
    }

    return started;
  }

  /**
   * Guide the user to grant Accessibility and start the hook once they do,
   * re-checking on a timer and whenever the app is activated (e.g. returning from System Settings).
   */
  private waitForAccessibility(): void {
    logger.warn('Accessibility not granted: push-to-talk is disabled until it is granted');

    this.accessibilityPoll = setInterval(() => this.tryStartKeyboardHook(), ACCESSIBILITY_POLL_MS);
    app.on('did-become-active', this.onAppActivated);

    this.showAccessibilityGuidance();
  }

  private stopWaitingForAccessibility(): void {
    if (this.accessibilityPoll) {
      clearInterval(this.accessibilityPoll);
      this.accessibilityPoll = null;
    }
    app.off('did-become-active', this.onAppActivated);
  }

  /**
   * Explain why Accessibility is needed and offer to open System Settings.
   * Shown as a sheet on a visible window: without a parent, macOS runs the alert
   * modally and blocks the main process (including the poll) until it is dismissed.
   */
  private showAccessibilityGuidance(): void {
    const parent = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible());
    const options: MessageBoxOptions = {
      type: 'warning',
      message: 'Accessibility permission required',
      detail:
        `${app.getName()} needs Accessibility access to detect the push-to-talk key ` +
        'and insert text.\n\n' +
        `Open System Settings > Privacy & Security > Accessibility and turn on ${app.getName()}. ` +
        'Push-to-talk starts automatically once access is granted; no restart is needed.',
      buttons: ['Open System Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };

    (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)).then(({ response }) => {
      if (response !== 0 || !this.accessibilityPoll) {
        return;
      }
      // Prompting adds the app to the Accessibility list so the user only has to switch it on
      permissionsService.getAccessibilityStatus(true);
      permissionsService.openSettings('accessibility');
    }).catch((error) => {
      logger.error('Failed to show accessibility guidance', { error });
    });
  }

  /**
   * Check if the service is currently active (recording).
   */
  get isRecording(): boolean {
    return this.isActive;
  }

  /**
   * Handle key down event (trigger key pressed).
   * Starts ASR session and shows floating window.
   */
  private async handleKeyDown(mode: InputMode = 'dictation'): Promise<void> {
    if (this.isActive || this.finishing) {
      logger.warn('Already recording, ignoring key down');
      return;
    }

    logger.info('Push-to-talk: START');
    this.isActive = true;

    // Best effort: returns null when history is disabled or storage is unavailable
    const settings = settingsService.get();
    this.mode = mode === 'command' && settings.success === true && settings.data.command.enabled ? 'command' : 'dictation';
    floatingWindow.sendMode(this.mode);
    if (this.mode === 'command') {
      this.commandModel = settings.success === true ? settings.data.command.model : DEFAULT_COMMAND_MODEL;
      commandService.warmUp(this.commandModel);
    } else if (settings.success === true && settings.data.polish.enabled) {
      polishService.warmUp(settings.data.polish.model);
    }
    this.historyId = historyService.begin({
      mode: this.mode,
      engine: 'whisper.cpp',
      language: settings.success ? settings.data.asr.language : null,
    });

    const starting = this.startSession();
    this.starting = starting;
    await starting;
    if (this.starting === starting) {
      this.starting = null;
    }
  }

  /**
   * Start ASR and recording for the session begun by handleKeyDown.
   * Never rejects: a failure ends the session and is shown in the floating window.
   */
  private async startSession(): Promise<void> {
    try {
      // Show floating window with listening status
      floatingWindow.sendStatus('connecting');

      // Start ASR session
      await asrService.start();

      // Update status to listening
      floatingWindow.sendStatus('listening');

      // Notify renderer to start recording
      this.notifyRendererStartRecording();

      logger.info('Push-to-talk session started');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start push-to-talk session', { error: message });

      // Reset state on failure
      this.isActive = false;
      historyService.fail(this.historyId, 'start_failed', message);
      this.historyId = null;

      // Show error in floating window
      floatingWindow.sendError(`Failed to start: ${message}`);
    }
  }

  /**
   * Handle key up event (trigger key released).
   * Stops ASR session, inserts text, and hides floating window.
   */
  private async handleKeyUp(): Promise<void> {
    if (!this.isActive) {
      logger.debug('Not recording, ignoring key up');
      return;
    }

    if (!(await this.waitForStart())) {
      return;
    }

    logger.info('Push-to-talk: STOP');
    this.isActive = false;
    this.finishing = true;
    const mode = this.mode;
    const commandModel = this.commandModel;
    const historyId = this.historyId;
    this.historyId = null;

    try {
      // Update floating window status
      floatingWindow.sendStatus('processing');
      historyService.markProcessing(historyId);

      // Notify renderer to stop recording
      this.notifyRendererStopRecording();

      // Stop ASR and get final result
      const settings = settingsService.get();
      // Attach the capture rejection handler immediately while ASR finishes in parallel.
      const selection = mode === 'command'
        ? commandService.captureSelection().then(text => ({ text, error: null }), error => ({
          text: null,
          error: error instanceof Error && error.message === 'Release Shift to run the command'
            ? error.message : 'Selection capture failed',
        }))
        : Promise.resolve({ text: null, error: null });
      const [outcome, captured] = await Promise.all([
        asrService.stopWithOutcome({
          keepProcessing: mode === 'command' || (settings.success === true && settings.data.polish.enabled),
        }),
        selection,
      ]);
      const result = outcome.result;

      if (mode === 'command' && outcome.error) {
        this.failCommand(historyId, 'Transcription failed');
        return;
      }

      if (result && result.text.trim()) {
        logger.info('ASR result received', {
          textLength: result.text.length,
          isFinal: result.isFinal,
        });

        let finalText = result.text;
        let polishLatencyMs = 0;
        if (mode === 'command') {
          if (captured.error) {
            this.failCommand(historyId, captured.error);
            return;
          }
          const commanded = await commandService.run(result.text, captured.text, { model: commandModel });
          if (commanded.error) {
            this.failCommand(historyId, commanded.error);
            return;
          }
          finalText = commanded.text;
          polishLatencyMs = commanded.latencyMs;
          logger.info('Command completed', { outputLength: finalText.length, latencyMs: commanded.latencyMs });
        } else if (settings.success === true && settings.data.polish.enabled) {
          const polished = await polishService.polish(result.text, {
            model: settings.data.polish.model, vocabulary: settings.data.asr.vocabulary,
          });
          finalText = polished.text;
          polishLatencyMs = polished.latencyMs;
          logger.info('AI polish completed', {
            polished: polished.polished, latencyMs: polished.latencyMs, error: polished.error,
          });
        }

        // Send result to floating window
        floatingWindow.sendResult({ ...result, text: finalText });
        floatingWindow.sendStatus('done');

        // IMPORTANT: Hide floating window FIRST to return focus to the previous app
        // Then wait a bit for the focus to switch before inserting text
        if (mode === 'dictation') floatingWindow.hide();

        // Insert text at cursor position after focus returns
        let insert: { status: 'inserted' | 'failed' | 'skipped'; error?: string } = { status: 'skipped' };
        if (this.config.autoInsertText && this.isAutoInsertEnabled()) {
          // Wait for focus to return to the previous application
          await new Promise(resolve => setTimeout(resolve, 100));

          const insertResult = textInputService.insert(finalText);

          if (!insertResult.success) {
            logger.error('Failed to insert text', { error: insertResult.error });
            // Show error briefly
            floatingWindow.sendError(`Insert failed: ${insertResult.error}`);
            insert = { status: 'failed', error: insertResult.error };
          } else {
            logger.info('Text inserted successfully');
            insert = { status: 'inserted' };
          }
        }

        // Record after insertion so history never delays typing; audio is written in the background
        this.recordCompletion(historyId, outcome, result.text, finalText, polishLatencyMs, insert);
      } else {
        logger.info('No ASR result to insert');

        if (outcome.error) {
          // Keep the error visible; ASRService already showed it and the floating window auto-hides it
          historyService.fail(historyId, 'transcription_failed', outcome.error);
        } else {
          floatingWindow.hide();
          this.recordCompletion(historyId, outcome, '', '');
        }
      }

      logger.info('Push-to-talk session completed');
    } catch (error) {
      if (mode === 'command') {
        this.failCommand(historyId, 'Command failed');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop push-to-talk session', { error: message });
      historyService.fail(historyId, 'stop_failed', message);

      // Show error in floating window briefly, then hide
      floatingWindow.sendError(`Error: ${message}`);
      setTimeout(() => {
        floatingWindow.hide();
      }, this.config.hideDelayMs * 2);
    } finally {
      this.finishing = false;
    }
  }

  /** Only pass fixed capture errors or the command service's sanitized error here. */
  private failCommand(historyId: string | null, message: string): void {
    logger.warn('Command session failed');
    historyService.fail(historyId, 'command_failed', message);
    floatingWindow.sendError(`指令失敗：${message}`);
  }

  /**
   * Handle a short press or a session interrupted by another key.
   * Ends the session without transcribing: whisper.cpp turns very short or silent clips
   * into phantom text such as "Thank you.", which must never be inserted.
   */
  private async handleCancel(durationMs: number): Promise<void> {
    if (!this.isActive) {
      logger.debug('Not recording, ignoring cancel');
      return;
    }

    if (!(await this.waitForStart())) {
      return;
    }

    logger.info('Push-to-talk: CANCEL', { durationMs });
    this.isActive = false;
    const historyId = this.historyId;
    this.historyId = null;

    try {
      this.notifyRendererStopRecording('idle');
      asrService.cancel();
    } catch (error) {
      logger.error('Failed to cancel push-to-talk session', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    floatingWindow.hide();

    // A tap is not a dictation: drop its row rather than keep an empty or failed entry
    if (historyId) {
      const removed = await historyService.delete({ id: historyId });
      if (!removed.success) {
        logger.warn('Failed to remove history of cancelled session', { error: removed.error });
      }
    }

    logger.info('Push-to-talk session cancelled');
  }

  /**
   * Wait for a start that is still connecting, so its 'listening' notification cannot
   * restart recording after the session ends.
   *
   * @returns false if the session failed to start (already reported and ended)
   */
  private async waitForStart(): Promise<boolean> {
    await this.starting;
    return this.isActive;
  }

  /**
   * Whether the user setting allows inserting text. Defaults to true if settings are unreadable.
   */
  private isAutoInsertEnabled(): boolean {
    const settings = settingsService.get();
    return settings.success ? settings.data.input.autoInsert : true;
  }

  /**
   * Record a finished session without waiting for the optional audio write.
   * Empty text is stored as an 'empty' session by the history service.
   */
  private recordCompletion(
    historyId: string | null,
    outcome: ASRSessionOutcome,
    rawText: string,
    finalText: string,
    polishLatencyMs = 0,
    insert?: { status: 'inserted' | 'failed' | 'skipped'; error?: string },
  ): void {
    void historyService.complete(historyId, {
      rawText,
      finalText,
      audioDurationMs: outcome.audioDurationMs,
      latencyMs: outcome.latencyMs + polishLatencyMs,
      detectedLanguage: outcome.detectedLanguage,
      ...(insert === undefined ? {} : { insert }),
      wav: outcome.wav,
    });
  }

  /**
   * Notify renderer process to start recording.
   */
  private notifyRendererStartRecording(): void {
    getTrustedWebContents('main')?.send(IPC_CHANNELS.ASR.STATUS, 'listening');
  }

  /** Notify the recording renderer to finish or discard its audio. */
  private notifyRendererStopRecording(status: 'processing' | 'idle' = 'processing'): void {
    getTrustedWebContents('main')?.send(IPC_CHANNELS.ASR.STATUS, status);
  }
}

/** Singleton instance of the push-to-talk service. */
export const pushToTalkService = new PushToTalkService();
