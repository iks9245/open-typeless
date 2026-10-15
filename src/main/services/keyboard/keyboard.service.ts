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
import type { InputMode } from '../../../shared/constants/command';
import { permissionsService } from '../permissions';

const logger = log.scope('keyboard-service');

/** The parts of a uiohook keyboard event the service reads */
interface KeyEventFlags {
  keycode: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

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
 *   () => console.log('Key up - stop recording'),
 *   (durationMs) => console.log(`Released after ${durationMs} ms - cancel recording`)
 * );
 * ```
 */
export class KeyboardService {
  private config: KeyboardConfig;
  private state: KeyboardState = {
    isKeyHeld: false,
    lastKeyDownTime: 0,
    recordingStartTime: 0,
  };

  private onKeyDown: ((mode: InputMode) => void) | null = null;
  private onKeyUp: (() => void) | null = null;
  private onCancel: ((durationMs: number) => void) | null = null;
  private isStarted = false;
  private readonly escapeListeners = new Set<() => void>();
  // Physical hold outlives a cancelled session, so repeats and deferred changes wait for release.
  private triggerHeld = false;
  private pendingTriggerKey: number | null = null;
  private readonly heldModifiers = new Set<number>();

  // Bound handlers for proper cleanup
  private boundKeyDownHandler: ((e: KeyEventFlags) => void) | null = null;
  private boundKeyUpHandler: ((e: KeyEventFlags) => void) | null = null;

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
   * Every press that reached onKeyDown ends in exactly one of onKeyUp or onCancel.
   *
   * @param onKeyDown - Called when trigger key is pressed
   * @param onKeyUp - Called when trigger key is released after at least minRecordingMs
   * @param onCancel - Called instead of onKeyUp for a short press or another key interrupting the hold
   * @returns true if the hook is running
   */
  register(
    onKeyDown: (mode: InputMode) => void,
    onKeyUp: () => void,
    onCancel: (durationMs: number) => void,
  ): boolean {
    if (this.isStarted) {
      logger.warn('KeyboardService already registered, unregistering first');
      this.unregister();
    }

    if (!permissionsService.getAccessibilityStatus()) {
      logger.warn('Accessibility not trusted, not starting keyboard hook');
      return false;
    }

    // Create bound handlers
    const keyDownHandler = (e: KeyEventFlags) => {
      this.syncModifiers(e);
      this.handleKeyDown(e.keycode, { shift: e.shiftKey, ctrl: e.ctrlKey });
    };
    const keyUpHandler = (e: KeyEventFlags) => {
      this.syncModifiers(e);
      this.handleKeyUp(e.keycode);
    };

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
    this.onCancel = onCancel;
    this.boundKeyDownHandler = keyDownHandler;
    this.boundKeyUpHandler = keyUpHandler;
    this.isStarted = true;

    logger.info('KeyboardService registered', { triggerKey: this.config.triggerKey });
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
    this.onCancel = null;
    this.boundKeyDownHandler = null;
    this.boundKeyUpHandler = null;
    this.isStarted = false;
    this.resetState();

    logger.info('KeyboardService unregistered');
  }

  /** Subscribe only while an answer is visible. This observes Esc without consuming it. */
  onEscape(listener: () => void): () => void {
    this.escapeListeners.add(listener);
    return () => { this.escapeListeners.delete(listener); };
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

  /** Defer a key change until the current physical trigger is released. */
  setTriggerKey(keycode: number): void {
    if (this.triggerHeld) {
      this.pendingTriggerKey = keycode;
    } else {
      this.config.triggerKey = keycode;
      this.state.lastKeyDownTime = 0;
    }
  }

  /** Wait until all physical Shift, Ctrl, Alt and Meta keys are up, with a bounded wait. */
  async waitForModifiersReleased(timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (this.heldModifiers.size) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) return false;
      await new Promise(resolve => setTimeout(resolve, Math.min(20, remaining)));
    }
    return true;
  }

  /**
   * Drop modifiers that an ordinary key event reports as up, so a missed key-up cannot leave
   * waitForModifiersReleased() waiting forever. Modifier events are skipped: their own flags
   * may not reflect the change yet.
   */
  private syncModifiers(e: KeyEventFlags): void {
    if (this.isModifier(e.keycode)) return;
    if (e.shiftKey === false) {
      this.heldModifiers.delete(UiohookKey.Shift);
      this.heldModifiers.delete(UiohookKey.ShiftRight);
    }
    if (e.altKey === false) {
      this.heldModifiers.delete(UiohookKey.Alt);
      this.heldModifiers.delete(UiohookKey.AltRight);
    }
    if (e.ctrlKey === false) {
      this.heldModifiers.delete(UiohookKey.Ctrl);
      this.heldModifiers.delete(UiohookKey.CtrlRight);
    }
    if (e.metaKey === false) {
      this.heldModifiers.delete(UiohookKey.Meta);
      this.heldModifiers.delete(UiohookKey.MetaRight);
    }
  }

  private isModifier(keycode: number): boolean {
    return new Set<number>([UiohookKey.Shift, UiohookKey.ShiftRight, UiohookKey.Alt, UiohookKey.AltRight,
      UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Meta, UiohookKey.MetaRight]).has(keycode);
  }

  /**
   * Reset internal state.
   */
  private resetState(): void {
    this.heldModifiers.clear();
    this.triggerHeld = false;
    if (this.pendingTriggerKey !== null) this.config.triggerKey = this.pendingTriggerKey;
    this.pendingTriggerKey = null;
    this.state = {
      isKeyHeld: false,
      lastKeyDownTime: 0,
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
  private handleKeyDown(keycode: number, modifiers?: { shift?: boolean; ctrl?: boolean }): void {
    if (keycode === UiohookKey.Escape && !this.state.isKeyHeld) {
      for (const listener of this.escapeListeners) listener();
    }
    if (this.isModifier(keycode)) this.heldModifiers.add(keycode);
    if (this.state.isKeyHeld && keycode !== this.config.triggerKey &&
      keycode !== UiohookKey.Shift && keycode !== UiohookKey.ShiftRight) {
      this.state.isKeyHeld = false;
      this.onCancel?.(Date.now() - this.state.recordingStartTime);
    }
    if (keycode !== this.config.triggerKey || this.triggerHeld) return;

    // Ignore if debounced (auto-repeat prevention)
    if (this.isDebounced(this.state.lastKeyDownTime)) {
      return;
    }

    // Ignore if already held (prevents duplicate events)
    if (this.state.isKeyHeld) {
      return;
    }

    // Update state
    this.triggerHeld = true;
    this.state.isKeyHeld = true;
    this.state.lastKeyDownTime = Date.now();
    this.state.recordingStartTime = Date.now();

    logger.debug('Trigger key pressed');

    // Call callback
    const shift = modifiers?.shift ?? (this.heldModifiers.has(UiohookKey.Shift) || this.heldModifiers.has(UiohookKey.ShiftRight));
    const controlTrigger = this.config.triggerKey === UiohookKey.Ctrl || this.config.triggerKey === UiohookKey.CtrlRight;
    const heldCtrl = [UiohookKey.Ctrl, UiohookKey.CtrlRight].some(code => code !== this.config.triggerKey && this.heldModifiers.has(code));
    const ctrl = controlTrigger ? heldCtrl : modifiers?.ctrl ?? heldCtrl;
    this.onKeyDown?.(ctrl ? 'ask' : shift ? 'command' : 'dictation');
  }

  /**
   * Handle key up event.
   */
  private handleKeyUp(keycode: number): void {
    this.heldModifiers.delete(keycode);
    // Ignore if not our trigger key
    if (keycode !== this.config.triggerKey) {
      return;
    }

    this.triggerHeld = false;
    if (this.pendingTriggerKey !== null) {
      this.config.triggerKey = this.pendingTriggerKey;
      this.pendingTriggerKey = null;
      this.state.lastKeyDownTime = 0;
    }

    // Ignore if not currently held. No debounce here: a release of a held key is never
    // a duplicate, and dropping one would leave the key held and the session running.
    if (!this.state.isKeyHeld) {
      return;
    }

    // Calculate recording duration
    const recordingDuration = Date.now() - this.state.recordingStartTime;

    // Update state
    this.state.isKeyHeld = false;

    // A press shorter than the minimum still started a session; it must be cancelled
    if (recordingDuration < this.config.minRecordingMs) {
      logger.debug('Recording too short, cancelling', {
        duration: recordingDuration,
        minRequired: this.config.minRecordingMs,
      });
      this.onCancel?.(recordingDuration);
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
