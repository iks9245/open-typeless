import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIpcEvent, mockWebContents } from './security-mocks';
import { registerTrustedWindow } from '../../src/main/ipc/sender';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), build: vi.fn(), comment: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/services/report', () => ({ reportService: { build: mocks.build, comment: mocks.comment } }));
import { setupReportHandlers } from '../../src/main/ipc/report.handler';

setupReportHandlers();
type Handler = (event: IpcMainInvokeEvent, input?: unknown) => unknown;
const handlers = new Map<string, Handler>(mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
const invoke = (channel: string, event: IpcMainInvokeEvent, input?: unknown) => handlers.get(channel)?.(event, input);
const mainEvent = () => {
  const { webContents } = mockWebContents('file:///app/index.html');
  registerTrustedWindow(webContents, 'main');
  return mockIpcEvent(webContents);
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.build.mockReturnValue({ success: true, data: { dictations: 3 } });
  mocks.comment.mockResolvedValue({ text: '說得好！' });
});

describe('report IPC', () => {
  it('registers both channels once and wraps comments in IpcResult', async () => {
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.REPORT.GET, IPC_CHANNELS.REPORT.COMMENT]);
    setupReportHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(await invoke(IPC_CHANNELS.REPORT.GET, mainEvent(), { range: 'week' }))
      .toEqual({ success: true, data: { dictations: 3 } });
    expect(mocks.build).toHaveBeenCalledWith({ range: 'week' });
    expect(await invoke(IPC_CHANNELS.REPORT.COMMENT, mainEvent(), { range: 'month' }))
      .toEqual({ success: true, data: { text: '說得好！' } });
    expect(mocks.comment).toHaveBeenCalledWith({ range: 'month' });
    mocks.comment.mockResolvedValueOnce({ error: 'oMLX not installed' });
    expect(await invoke(IPC_CHANNELS.REPORT.COMMENT, mainEvent(), { range: 'all' }))
      .toEqual({ success: false, error: 'oMLX not installed' });
  });

  it.each(['unregistered', 'floating', 'subframe'] as const)('rejects %s senders before service access', async kind => {
    const { webContents } = mockWebContents('file:///app/index.html');
    if (kind === 'floating') registerTrustedWindow(webContents, 'floating');
    if (kind === 'subframe') registerTrustedWindow(webContents, 'main');
    const event = mockIpcEvent(webContents, kind === 'subframe' ? null : webContents.mainFrame);
    for (const channel of handlers.keys()) expect(await invoke(channel, event, { range: 'week' }))
      .toEqual({ success: false, error: 'Untrusted sender' });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.comment).not.toHaveBeenCalled();
  });

  it('returns fixed errors for unexpected service failures', async () => {
    mocks.build.mockImplementationOnce(() => { throw new Error('private storage'); });
    mocks.comment.mockRejectedValueOnce(new Error('private text'));
    for (const channel of handlers.keys()) expect(await invoke(channel, mainEvent(), { range: 'week' }))
      .toEqual({ success: false, error: 'Internal error' });
  });
});
