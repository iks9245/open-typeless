import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('uiohook-napi', () => ({
  UiohookKey: { Shift: 42, ShiftRight: 54, Alt: 56, AltRight: 3640 },
  uIOhook: { on: vi.fn(), off: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../src/main/services/permissions', () => ({ permissionsService: { getAccessibilityStatus: () => true } }));
import { KeyboardService } from '../../src/main/services/keyboard/keyboard.service';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { InputMode } from '../../src/shared/constants/command';

interface Internals {
  handleKeyDown(keycode: number, modifiers?: { shift?: boolean }): void;
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
