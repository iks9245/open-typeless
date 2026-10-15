import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIpcEvent, mockWebContents } from './security-mocks';
import { registerTrustedWindow } from '../../src/main/ipc/sender';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), ask: vi.fn(), status: vi.fn(), reindex: vi.fn(), history: vi.fn(), onAnswered: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/services/memory', () => ({ memoryService: mocks }));
import { setupMemoryHandlers } from '../../src/main/ipc/memory.handler';
setupMemoryHandlers();
const handlers = new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => Promise<unknown>>(
  mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]),
);
const onAnswered = mocks.onAnswered.mock.calls[0][0];
const main = () => {
  const fixture = mockWebContents('file:///app/index.html');
  registerTrustedWindow(fixture.webContents, 'main');
  return fixture;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ask.mockResolvedValue({ success: true, data: { answer: 'answer', sources: [] } });
  mocks.status.mockReturnValue({ state: 'idle' });
  mocks.reindex.mockReturnValue({ success: true, data: undefined });
  mocks.history.mockReturnValue([]);
});
describe('memory IPC role boundary', () => {
  it('registers four handlers and one event forwarding subscription only once', async () => {
    expect([...handlers.keys()]).toEqual(['memory:ask', 'memory:status', 'memory:reindex', 'memory:history']);
    setupMemoryHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
    const event = mockIpcEvent(main().webContents);
    expect(await handlers.get('memory:ask')?.(event, { question: 'Ken' })).toMatchObject({ success: true });
    expect(mocks.ask).toHaveBeenCalledWith({ question: 'Ken' });
    expect(await handlers.get('memory:status')?.(event)).toEqual({ success: true, data: { state: 'idle' } });
    expect(await handlers.get('memory:history')?.(event)).toEqual({ success: true, data: [] });
    expect(await handlers.get('memory:reindex')?.(event)).toEqual({ success: true, data: undefined });
  });
  it.each(['unregistered', 'floating', 'subframe'])('rejects %s senders for every memory handler', async kind => {
    const { webContents } = mockWebContents('file:///app/index.html');
    if (kind === 'floating') registerTrustedWindow(webContents, 'floating');
    if (kind === 'subframe') registerTrustedWindow(webContents, 'main');
    const event = mockIpcEvent(webContents, kind === 'subframe' ? null : webContents.mainFrame);
    for (const handler of handlers.values()) expect(await handler(event, {})).toEqual({ success: false, error: 'Untrusted sender' });
    for (const method of [mocks.ask, mocks.status, mocks.reindex, mocks.history]) expect(method).not.toHaveBeenCalled();
  });
  it('filters unexpected service exceptions', async () => {
    mocks.ask.mockRejectedValueOnce(new Error('private question'));
    expect(await handlers.get('memory:ask')?.(mockIpcEvent(main().webContents), {}))
      .toEqual({ success: false, error: 'Memory operation failed' });
  });
  it('sends answered events only to the trusted main window', () => {
    const fixture = main();
    const send = vi.fn();
    fixture.webContents.send = send;
    onAnswered({ id: 'entry' });
    expect(send).toHaveBeenCalledWith('ask:answered', { id: 'entry' });
    fixture.mainFrame.url = 'file:///elsewhere';
    onAnswered({ id: 'other' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
