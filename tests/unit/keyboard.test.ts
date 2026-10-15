import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('uiohook-napi', () => ({
  UiohookKey: { Escape: 1, Shift: 42, ShiftRight: 54, Alt: 56, AltRight: 3640, Ctrl: 29, CtrlRight: 3613, Meta: 3675, MetaRight: 3676, F13: 91, F14: 92, F15: 93 },
  uIOhook: { on: vi.fn(), off: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../src/main/services/permissions', () => ({ permissionsService: { getAccessibilityStatus: () => true } }));
import { KeyboardService } from '../../src/main/services/keyboard/keyboard.service';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { InputMode } from '../../src/shared/constants/command';

interface Internals {
  config: { triggerKey: number };
  handleKeyDown(keycode: number, modifiers?: { shift?: boolean; ctrl?: boolean }): void;
  handleKeyUp(keycode: number): void;
}
function fixture() {
  const service = new KeyboardService({ debounceMs: 0, minRecordingMs: 200 });
  const down = vi.fn<(mode: InputMode) => void>();
  const up = vi.fn();
  const cancel = vi.fn();
  service.register(down, up, cancel);
  return { service, keyboard: service as unknown as Internals, down, up, cancel };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('keyboard modes and modifiers', () => {
  it('defaults to dictation and supports an explicit Shift state without breaking single-argument callers', () => {
    const { keyboard, service, down } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).toHaveBeenLastCalledWith('dictation');
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyDown(UiohookKey.AltRight, { shift: true });
    expect(down).toHaveBeenLastCalledWith('command');
    service.unregister();
  });

  it.each([UiohookKey.Shift, UiohookKey.ShiftRight])('uses physical Shift %s at trigger down and never changes mode mid-press', shift => {
    const { keyboard, service, down } = fixture();
    keyboard.handleKeyDown(shift);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    keyboard.handleKeyUp(shift);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledWith('command');
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).toHaveBeenLastCalledWith('dictation');
    service.unregister();
  });

  it('receives physical events from the native hook', () => {
    const { down, service } = fixture();
    const calls = vi.mocked(uIOhook.on).mock.calls as unknown as [string, (event: { keycode: number }) => void][];
    const callback = calls.find(([event]) => event === 'keydown')?.[1];
    expect(callback).toBeDefined();
    const keyDown = callback as (event: { keycode: number }) => void;
    keyDown({ keycode: UiohookKey.ShiftRight });
    keyDown({ keycode: UiohookKey.AltRight });
    expect(down).toHaveBeenCalledWith('command');
    service.unregister();
  });

  it('waits for both Shift keys and both Option keys, then resolves', async () => {
    vi.useFakeTimers();
    const { keyboard, service } = fixture();
    for (const code of [UiohookKey.Shift, UiohookKey.ShiftRight, UiohookKey.Alt, UiohookKey.AltRight]) keyboard.handleKeyDown(code);
    let resolved = false;
    const waiting = service.waitForModifiersReleased(1500).then(value => { resolved = true; return value; });
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyUp(UiohookKey.Shift);
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(false);
    keyboard.handleKeyUp(UiohookKey.ShiftRight);
    keyboard.handleKeyUp(UiohookKey.Alt);
    await vi.advanceTimersByTimeAsync(20);
    expect(await waiting).toBe(true);
    service.unregister();
  });

  it('times out while held and returns true immediately when nothing is held', async () => {
    vi.useFakeTimers();
    const { keyboard, service } = fixture();
    expect(await service.waitForModifiersReleased(0)).toBe(true);
    keyboard.handleKeyDown(UiohookKey.Shift);
    const waiting = service.waitForModifiersReleased(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await waiting).toBe(false);
    service.unregister();
    expect(await service.waitForModifiersReleased(0)).toBe(true);
  });

  it('still cancels short command presses and ends longer presses exactly once', async () => {
    vi.useFakeTimers();
    const { keyboard, service, cancel, up } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight, { shift: true });
    await vi.advanceTimersByTimeAsync(50);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(cancel).toHaveBeenCalledWith(50);
    expect(up).not.toHaveBeenCalled();
    keyboard.handleKeyDown(UiohookKey.AltRight, { shift: true });
    await vi.advanceTimersByTimeAsync(300);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(up).toHaveBeenCalledOnce();
    service.unregister();
  });

  it('reads Shift from hook events and drops a modifier whose key-up was missed', async () => {
    const { service, down } = fixture();
    const handler = (type: string) => vi.mocked(uIOhook.on).mock.calls.find(([event]) => event === type)?.[1] as unknown as
      (e: { keycode: number; shiftKey: boolean; altKey: boolean }) => void;
    handler('keydown')({ keycode: UiohookKey.Shift, shiftKey: true, altKey: false });
    handler('keydown')({ keycode: UiohookKey.AltRight, shiftKey: true, altKey: true });
    expect(down).toHaveBeenLastCalledWith('command');
    handler('keyup')({ keycode: UiohookKey.AltRight, shiftKey: true, altKey: false });
    // The Shift key-up never arrives, but the next ordinary key reports Shift as up
    expect(await service.waitForModifiersReleased(0)).toBe(false);
    handler('keydown')({ keycode: 30, shiftKey: false, altKey: false });
    expect(await service.waitForModifiersReleased(0)).toBe(true);
    service.unregister();
  });
});

describe('configurable triggers and interruptions', () => {
  it.each([UiohookKey.MetaRight, UiohookKey.CtrlRight, UiohookKey.Alt, UiohookKey.F13, UiohookKey.F14, UiohookKey.F15])('changes the live key to %s', async keycode => {
    vi.useFakeTimers();
    const { service, keyboard, down, up } = fixture();
    service.setTriggerKey(keycode);
    expect(keyboard.config.triggerKey).toBe(keycode);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).not.toHaveBeenCalled();
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyDown(keycode);
    await vi.advanceTimersByTimeAsync(250);
    keyboard.handleKeyUp(keycode);
    expect(down).toHaveBeenCalledOnce();
    expect(down).toHaveBeenCalledWith('dictation');
    expect(up).toHaveBeenCalledOnce();
    service.unregister();
  });

  it('defers changes while held, applies only the last change, and ends the old session', async () => {
    vi.useFakeTimers();
    const { service, keyboard, down, up } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    service.setTriggerKey(UiohookKey.F13);
    service.setTriggerKey(UiohookKey.F14);
    expect(keyboard.config.triggerKey).toBe(UiohookKey.AltRight);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    await vi.advanceTimersByTimeAsync(300);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(up).toHaveBeenCalledOnce();
    expect(keyboard.config.triggerKey).toBe(UiohookKey.F14);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).toHaveBeenCalledOnce();
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyDown(UiohookKey.F14, { shift: true });
    expect(down).toHaveBeenLastCalledWith('command');
    service.unregister();
  });

  it.each([30, UiohookKey.Ctrl, UiohookKey.MetaRight, UiohookKey.Alt])('cancels on key %s, ignores repeats and later release, and recovers on the next press', async keycode => {
    vi.useFakeTimers();
    const { service, keyboard, down, up, cancel } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    await vi.advanceTimersByTimeAsync(300);
    keyboard.handleKeyDown(keycode);
    keyboard.handleKeyDown(keycode);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(300);
    expect(down).toHaveBeenCalledOnce();
    keyboard.handleKeyUp(keycode);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(up).not.toHaveBeenCalled();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    await vi.advanceTimersByTimeAsync(300);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(down).toHaveBeenCalledTimes(2);
    expect(up).toHaveBeenCalledOnce();
    service.unregister();
  });

  it('keeps a pending change deferred after interruption until the physical release', () => {
    const { service, keyboard, cancel, up } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    keyboard.handleKeyDown(30);
    service.setTriggerKey(UiohookKey.F13);
    expect(keyboard.config.triggerKey).toBe(UiohookKey.AltRight);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    expect(keyboard.config.triggerKey).toBe(UiohookKey.F13);
    expect(cancel).toHaveBeenCalledOnce();
    expect(up).not.toHaveBeenCalled();
    service.unregister();
  });

  it.each([UiohookKey.Shift, UiohookKey.ShiftRight])('Shift %s and trigger repeats never interrupt', async shift => {
    vi.useFakeTimers();
    const { service, keyboard, cancel, up, down } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight);
    keyboard.handleKeyDown(shift);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    await vi.advanceTimersByTimeAsync(300);
    keyboard.handleKeyUp(UiohookKey.AltRight);
    keyboard.handleKeyUp(shift);
    expect(cancel).not.toHaveBeenCalled();
    expect(up).toHaveBeenCalledOnce();
    expect(down).toHaveBeenCalledOnce();
    expect(down).toHaveBeenCalledWith('dictation');
    service.unregister();
  });

  it('waits for both Ctrl and Meta sides and resyncs only groups reported as released', async () => {
    const { keyboard, service } = fixture();
    const codes = [UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Meta, UiohookKey.MetaRight];
    for (const code of codes) keyboard.handleKeyDown(code);
    expect(await service.waitForModifiersReleased(0)).toBe(false);
    keyboard.handleKeyUp(UiohookKey.Ctrl);
    keyboard.handleKeyUp(UiohookKey.Meta);
    expect(await service.waitForModifiersReleased(0)).toBe(false);
    const calls = vi.mocked(uIOhook.on).mock.calls as unknown as [string, unknown][];
    const handler = calls.find(([event]) => event === 'keydown')?.[1] as
      (event: { keycode: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
    handler({ keycode: 30, shiftKey: false, altKey: false, ctrlKey: false, metaKey: true });
    expect(await service.waitForModifiersReleased(0)).toBe(false);
    handler({ keycode: 30, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
    expect(await service.waitForModifiersReleased(0)).toBe(true);
    for (const code of codes) {
      keyboard.handleKeyDown(code);
      expect(await service.waitForModifiersReleased(0)).toBe(false);
      keyboard.handleKeyUp(code);
      expect(await service.waitForModifiersReleased(0)).toBe(true);
    }
    service.unregister();
  });
});


describe('ask mode and temporary Esc subscription', () => {
  it.each([UiohookKey.Ctrl, UiohookKey.CtrlRight])('Control %s beats Shift at trigger down', ctrl => {
    const { keyboard, service, down } = fixture();
    keyboard.handleKeyDown(ctrl);
    keyboard.handleKeyDown(UiohookKey.Shift);
    keyboard.handleKeyDown(UiohookKey.AltRight);
    expect(down).toHaveBeenCalledWith('ask');
    service.unregister();
  });
  it('uses the event Control flag and excludes Control when it is the trigger', () => {
    const { keyboard, service, down } = fixture();
    keyboard.handleKeyDown(UiohookKey.AltRight, { shift: true, ctrl: true });
    expect(down).toHaveBeenLastCalledWith('ask');
    keyboard.handleKeyUp(UiohookKey.AltRight);
    service.setTriggerKey(UiohookKey.CtrlRight);
    keyboard.handleKeyDown(UiohookKey.CtrlRight, { ctrl: true });
    expect(down).toHaveBeenLastCalledWith('dictation');
    keyboard.handleKeyUp(UiohookKey.CtrlRight);
    keyboard.handleKeyDown(UiohookKey.Ctrl);
    keyboard.handleKeyDown(UiohookKey.CtrlRight);
    expect(down).toHaveBeenLastCalledWith('ask');
    service.unregister();
  });
  it('observes Esc only while subscribed, does not replace trigger callbacks or add hook listeners', () => {
    const { keyboard, service, down } = fixture();
    const listener = vi.fn();
    const before = vi.mocked(uIOhook.on).mock.calls.length;
    const unsubscribe = service.onEscape(listener);
    keyboard.handleKeyDown(UiohookKey.Escape);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    keyboard.handleKeyDown(UiohookKey.Escape);
    expect(listener).toHaveBeenCalledOnce();
    expect(down).not.toHaveBeenCalled();
    expect(vi.mocked(uIOhook.on).mock.calls.length).toBe(before);
    service.unregister();
  });
});
