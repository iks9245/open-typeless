import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskResult } from '../../src/shared/types/memory';

const mocks = vi.hoisted(() => ({ onEscape: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../src/main/services/keyboard', () => ({ keyboardService: { onEscape: mocks.onEscape } }));
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 1000 } }) } }));
import { FloatingWindowManager } from '../../src/main/windows/floating';

let manager: FloatingWindowManager;
let win: { hide: ReturnType<typeof vi.fn>; showInactive: ReturnType<typeof vi.fn>; webContents: { send: ReturnType<typeof vi.fn> }; setBounds: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.onEscape.mockReturnValue(mocks.unsubscribe);
  manager = new FloatingWindowManager();
  win = { hide: vi.fn(), showInactive: vi.fn(), webContents: { send: vi.fn() }, setBounds: vi.fn() };
  Object.assign(win, { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ x: 0, y: 0 }) });
  Object.assign(manager, { window: win });
});
afterEach(() => { manager.hide(); vi.useRealTimers(); });
const result = (answer: string): AskResult => ({ answer, sources: [] });

describe('floating ask answer lifecycle', () => {
  it('shows the answer and keeps it for 8s + 60ms per code point, without focus', async () => {
    manager.sendAnswer(result('😀'));
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledWith('floating-window:answer', result('😀'));
    expect(win.webContents.send).toHaveBeenCalledWith('asr:result', { text: '😀', isFinal: true, type: 'final' });
    await vi.advanceTimersByTimeAsync(8059);
    expect(win.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(win.hide).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it('caps the timeout at 30s and observes global Esc through the existing keyboard API', async () => {
    manager.sendAnswer(result('文'.repeat(1000)));
    await vi.advanceTimersByTimeAsync(29999);
    expect(win.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(win.hide).toHaveBeenCalledOnce();
    manager.sendAnswer(result('next'));
    mocks.onEscape.mock.calls.at(-1)?.[0]();
    expect(win.hide).toHaveBeenCalledTimes(2);
  });
  it('removes the temporary Esc listener and old timeout on another session', async () => {
    manager.sendAnswer(result('old'));
    manager.sendStatus('connecting');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(win.hide).not.toHaveBeenCalled();
  });
  it('keeps native height clamped for arbitrarily long answers', () => {
    manager.setContentHeight(100000);
    expect(win.setBounds.mock.calls[0][0].height).toBe(112);
  });
});
