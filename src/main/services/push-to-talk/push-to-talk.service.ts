/**
 * Push-to-Talk Service.
 * Orchestrates keyboard hooks, ASR, and text insertion for voice input.
 *
 * Flow:
 * 1. User holds Right Option key
 * 2. KeyboardService detects keydown -> triggers handleKeyDown
 * 3. ASR session starts, floating window shows
 * 4. Renderer starts recording, sends audio chunks
 * 5. User releases Right Option key
 * 6. KeyboardService detects keyup -> triggers handleKeyUp
 * 7. ASR session stops, gets final result
 * 8. Text is inserted at cursor position
 * 9. Floating window hides
 */

import { app, BrowserWindow, dialog } from 'electron';
import type { MessageBoxOptions } from 'electron';
import log from 'electron-log';
import { keyboardService } from '../keyboard';
import { textInputService } from '../text-input';
import { asrService } from '../asr';
import type { ASRSessionOutcome } from '../asr';
import { historyService } from '../history';
import { settingsService } from '../settings';
import { permissionsService } from '../permissions';
import { floatingWindow } from '../../windows';
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
  private isInitialized = false;
  /** History row of the active session; null when history is off or unavailable */
  private historyId: string | null = null;
  /** Polls for Accessibility trust; null when not waiting for it */
  private accessibilityPoll: NodeJS.Timeout | null = null;
  private readonly onAppActivated = (): void => {
    this.tryStartKeyboardHook();
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

    // Log permission status for debugging
    permissionsService.logPermissionStatus();

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
      () => this.handleKeyDown(),
      () => this.handleKeyUp()
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
        `${app.getName()} needs Accessibility access to detect the push-to-talk key (Right Option) ` +
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
  private async handleKeyDown(): Promise<void> {
    if (this.isActive) {
      logger.warn('Already recording, ignoring key down');
      return;
    }

    logger.info('Push-to-talk: START');
    this.isActive = true;

    // Best effort: returns null when history is disabled or storage is unavailable
    const settings = settingsService.get();
    this.historyId = historyService.begin({
      engine: 'whisper.cpp',
      language: settings.success ? settings.data.asr.language : null,
    });

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

    logger.info('Push-to-talk: STOP');
    this.isActive = false;
    const historyId = this.historyId;
    this.historyId = null;

    try {
      // Update floating window status
      floatingWindow.sendStatus('processing');
      historyService.markProcessing(historyId);

      // Notify renderer to stop recording
      this.notifyRendererStopRecording();

      // Stop ASR and get final result
      const outcome = await asrService.stopWithOutcome();
      const result = outcome.result;

      if (result && result.text) {
        logger.info('ASR result received', {
          textLength: result.text.length,
          isFinal: result.isFinal,
        });

        // Send result to floating window
        floatingWindow.sendResult(result);
        floatingWindow.sendStatus('done');

        // IMPORTANT: Hide floating window FIRST to return focus to the previous app
        // Then wait a bit for the focus to switch before inserting text
        floatingWindow.hide();

        // Insert text at cursor position after focus returns
        let insert: { status: 'inserted' | 'failed' | 'skipped'; error?: string } = { status: 'skipped' };
        if (this.config.autoInsertText && this.isAutoInsertEnabled()) {
          // Wait for focus to return to the previous application
          await new Promise(resolve => setTimeout(resolve, 100));

          const insertResult = textInputService.insert(result.text);

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
        this.recordCompletion(historyId, outcome, result.text, insert);
      } else {
        logger.info('No ASR result to insert');
        // Hide floating window
        floatingWindow.hide();

        if (outcome.error) {
          historyService.fail(historyId, 'transcription_failed', outcome.error);
        } else {
          this.recordCompletion(historyId, outcome, '');
        }
      }

      logger.info('Push-to-talk session completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop push-to-talk session', { error: message });
      historyService.fail(historyId, 'stop_failed', message);

      // Show error in floating window briefly, then hide
      floatingWindow.sendError(`Error: ${message}`);
      setTimeout(() => {
        floatingWindow.hide();
      }, this.config.hideDelayMs * 2);
    }
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
    text: string,
    insert?: { status: 'inserted' | 'failed' | 'skipped'; error?: string },
  ): void {
    void historyService.complete(historyId, {
      rawText: text,
      finalText: text,
      audioDurationMs: outcome.audioDurationMs,
      latencyMs: outcome.latencyMs,
      detectedLanguage: outcome.detectedLanguage,
      ...(insert === undefined ? {} : { insert }),
      wav: outcome.wav,
    });
  }

  /**
   * Notify renderer process to start recording.
   */
  private notifyRendererStartRecording(): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ASR.STATUS, 'listening');
    }
  }

  /**
   * Notify renderer process to stop recording.
   */
  private notifyRendererStopRecording(): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ASR.STATUS, 'processing');
    }
  }

  /**
   * Get the main application window.
   */
  private getMainWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find(
      (win) => !win.isDestroyed()
    ) ?? null;
  }
}

/**
 * Singleton instance of the push-to-talk service.
 */
export const pushToTalkService = new PushToTalkService();
