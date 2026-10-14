/**
 * Keyboard Service.
 * Provides global keyboard monitoring using uiohook-napi.
 *
 * This service enables detection of keyboard events globally,
 * even when the application is not focused. Used primarily for
 * Push-to-Talk functionality.
 */

import { uIOhook, UiohookKey } from 'uiohook-napi';
import log from 'electron-log';
import { permissionsService } from '../permissions';

const logger = log.scope('keyboard-service');

/**
 * Configuration for keyboard service.
 */
export interface KeyboardConfig {
  /** Key code to trigger push-to-talk (default: Right Alt/Option) */
  triggerKey: number;
  /** Debounce time in milliseconds to prevent duplicate events */
  debounceMs: number;
  /** Minimum recording duration in milliseconds */
  minRecordingMs: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: KeyboardConfig = {
  triggerKey: UiohookKey.AltRight, // Right Option on macOS
  debounceMs: 50,
  minRecordingMs: 200,
};

/**
 * Internal state for keyboard service.
 */
interface KeyboardState {
  isKeyHeld: boolean;
  lastKeyDownTime: number;
  lastKeyUpTime: number;
  recordingStartTime: number;
}

/**
 * Keyboard Service for global keyboard monitoring.
 *
 * Uses uiohook-napi to detect key press/release events globally.
 * Handles debouncing and minimum recording duration.
 *
 * @example
 * ```typescript
 * keyboardService.register(
 *   () => console.log('Key down - start recording'),
 *   () => console.log('Key up - stop recording')
 * );
 * ```
 */
export class KeyboardService {
  private config: KeyboardConfig;
  private state: KeyboardState = {
    isKeyHeld: false,
    lastKeyDownTime: 0,
    lastKeyUpTime: 0,
    recordingStartTime: 0,
  };

  private onKeyDown: (() => void) | null = null;
  private onKeyUp: (() => void) | null = null;
  private isStarted = false;

  // Bound handlers for proper cleanup
  private boundKeyDownHandler: ((e: { keycode: number }) => void) | null = null;
  private boundKeyUpHandler: ((e: { keycode: number }) => void) | null = null;

  constructor(config: Partial<KeyboardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('KeyboardService created', {
      triggerKey: this.config.triggerKey,
      debounceMs: this.config.debounceMs,
      minRecordingMs: this.config.minRecordingMs,
    });
  }

  /**
   * Register callbacks for key down/up events.
   *
   * Refuses to start when macOS Accessibility is not trusted: libuiohook's hook
   * fails to start without it, and that failure path in uiohook-napi aborts the
   * whole process (uv_mutex_destroy on a locked mutex) instead of throwing.
   *
   * @param onKeyDown - Called when trigger key is pressed
   * @param onKeyUp - Called when trigger key is released (after min duration)
   * @returns true if the hook is running
   */
  register(onKeyDown: () => void, onKeyUp: () => void): boolean {
    if (this.isStarted) {
      logger.warn('KeyboardService already registered, unregistering first');
      this.unregister();
    }

    if (!permissionsService.getAccessibilityStatus()) {
      logger.warn('Accessibility not trusted, not starting keyboard hook');
      return false;
    }

    // Create bound handlers
    const keyDownHandler = (e: { keycode: number }) => this.handleKeyDown(e.keycode);
    const keyUpHandler = (e: { keycode: number }) => this.handleKeyUp(e.keycode);

    // Register event listeners
    uIOhook.on('keydown', keyDownHandler);
    uIOhook.on('keyup', keyUpHandler);

    // Start the hook
    try {
      uIOhook.start();
    } catch (error) {
      uIOhook.off('keydown', keyDownHandler);
      uIOhook.off('keyup', keyUpHandler);
      logger.error('Failed to start keyboard hook', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    this.onKeyDown = onKeyDown;
    this.onKeyUp = onKeyUp;
    this.boundKeyDownHandler = keyDownHandler;
    this.boundKeyUpHandler = keyUpHandler;
    this.isStarted = true;

    logger.info('KeyboardService registered: Hold Right Option to trigger');
    return true;
  }

  /**
   * Unregister callbacks and stop keyboard monitoring.
   */
  unregister(): void {
    if (!this.isStarted) {
      return;
    }

    // Remove event listeners before stopping
    if (this.boundKeyDownHandler) {
      uIOhook.off('keydown', this.boundKeyDownHandler);
    }
    if (this.boundKeyUpHandler) {
      uIOhook.off('keyup', this.boundKeyUpHandler);
    }

    // Stop the hook
    uIOhook.stop();

    // Clean up state
    this.onKeyDown = null;
    this.onKeyUp = null;
    this.boundKeyDownHandler = null;
    this.boundKeyUpHandler = null;
    this.isStarted = false;
    this.resetState();

    logger.info('KeyboardService unregistered');
  }

  /**
   * Check if keyboard service is currently active.
   */
  get isActive(): boolean {
    return this.isStarted;
  }

  /**
   * Check if the trigger key is currently held.
   */
  get isKeyCurrentlyHeld(): boolean {
    return this.state.isKeyHeld;
  }

  /**
   * Reset internal state.
   */
  private resetState(): void {
    this.state = {
      isKeyHeld: false,
      lastKeyDownTime: 0,
      lastKeyUpTime: 0,
      recordingStartTime: 0,
    };
  }

  /**
   * Check if an event should be debounced.
   */
  private isDebounced(lastTime: number): boolean {
    return Date.now() - lastTime < this.config.debounceMs;
  }

  /**
   * Handle key down event.
   */
  private handleKeyDown(keycode: number): void {
    // Ignore if not our trigger key
    if (keycode !== this.config.triggerKey) {
      return;
    }

    // Ignore if debounced (auto-repeat prevention)
    if (this.isDebounced(this.state.lastKeyDownTime)) {
      return;
    }

    // Ignore if already held (prevents duplicate events)
    if (this.state.isKeyHeld) {
      return;
    }

    // Update state
    this.state.isKeyHeld = true;
    this.state.lastKeyDownTime = Date.now();
    this.state.recordingStartTime = Date.now();

    logger.debug('Trigger key pressed');

    // Call callback
    this.onKeyDown?.();
  }

  /**
   * Handle key up event.
   */
  private handleKeyUp(keycode: number): void {
    // Ignore if not our trigger key
    if (keycode !== this.config.triggerKey) {
      return;
    }

    // Ignore if not currently held
    if (!this.state.isKeyHeld) {
      return;
    }

    // Ignore if debounced
    if (this.isDebounced(this.state.lastKeyUpTime)) {
      return;
    }

    // Calculate recording duration
    const recordingDuration = Date.now() - this.state.recordingStartTime;

    // Update state
    this.state.isKeyHeld = false;
    this.state.lastKeyUpTime = Date.now();

    // Check minimum recording duration
    if (recordingDuration < this.config.minRecordingMs) {
      logger.debug('Recording too short, ignoring', {
        duration: recordingDuration,
        minRequired: this.config.minRecordingMs,
      });
      return;
    }

    logger.debug('Trigger key released', { duration: recordingDuration });

    // Call callback
    this.onKeyUp?.();
  }
}

/**
 * Singleton instance of the keyboard service.
 */
export const keyboardService = new KeyboardService();
