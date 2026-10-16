import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';
import { registerTrustedWindow } from '../../src/main/ipc/sender';
import { mockIpcEvent, mockWebContents } from './security-mocks';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), summary: vi.fn(), export: vi.fn(), save: vi.fn(), reveal: vi.fn(), external: vi.fn(), fromContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle }, app: { getPath: () => '/Users/test/Desktop' },
  BrowserWindow: { fromWebContents: mocks.fromContents }, dialog: { showSaveDialog: mocks.save },
  shell: { showItemInFolder: mocks.reveal, openExternal: mocks.external },
}));
vi.mock('../../src/main/services/diagnostics', () => ({ diagnosticsService: { summary: mocks.summary, export: mocks.export } }));
import { diagnosticsFileName, setupDiagnosticsHandlers } from '../../src/main/ipc/diagnostics.handler';
setupDiagnosticsHandlers();
const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(
  mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]),
);
const main = () => {
  const { webContents } = mockWebContents('file:///app/index.html');
  registerTrustedWindow(webContents, 'main');
  return mockIpcEvent(webContents);
};
const invoke = (channel: string, event = main(), ...args: unknown[]) => handlers.get(channel)?.(event, ...args);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fromContents.mockReturnValue({ isDestroyed: () => false });
  mocks.summary.mockResolvedValue({ app: { version: '1.0.0' }, system: {} });
  mocks.export.mockImplementation(async (file: string) => file);
  mocks.save.mockResolvedValue({ canceled: true });
});

describe('diagnostics IPC', () => {
  it('registers exactly the four main-only channels once', () => {
    expect([...handlers.keys()]).toEqual(Object.values(IPC_CHANNELS.DIAGNOSTICS));
    setupDiagnosticsHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(diagnosticsFileName(new Date(2026, 9, 6, 9, 5))).toBe('open-typeless-diagnostics-20261006-0905.zip');
  });
  it.each(['unregistered', 'floating', 'subframe', 'navigated'] as const)('rejects %s senders for all operations', async kind => {
    const { webContents, mainFrame } = mockWebContents('file:///app/index.html');
    if (kind !== 'unregistered') registerTrustedWindow(webContents, kind === 'floating' ? 'floating' : 'main');
    if (kind === 'navigated') mainFrame.url = 'https://example.com';
    const event = mockIpcEvent(webContents, kind === 'subframe' ? null : webContents.mainFrame);
    for (const handler of handlers.values()) expect(await handler(event)).toEqual({ success: false, error: 'Untrusted sender' });
    for (const method of [mocks.summary, mocks.export, mocks.save, mocks.reveal, mocks.external]) expect(method).not.toHaveBeenCalled();
  });
  it('shows a save dialog on the main window and supports cancellation without exporting', async () => {
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT)).toEqual({ success: true, data: { saved: false, fileName: null } });
    expect(mocks.save).toHaveBeenCalledWith(mocks.fromContents.mock.results[0].value, expect.objectContaining({ defaultPath: expect.stringMatching(/^\/Users\/test\/Desktop\/open-typeless-diagnostics-\d{8}-\d{4}\.zip$/) }));
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('returns the summary and keeps save/reveal paths in main, ignoring renderer paths', async () => {
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.SUMMARY)).toEqual({ success: true, data: await mocks.summary() });
    await invoke(IPC_CHANNELS.DIAGNOSTICS.REVEAL);
    expect(mocks.reveal).not.toHaveBeenCalled();
    mocks.save.mockResolvedValueOnce({ canceled: false, filePath: '/private/support/diagnostics.zip' });
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT, main(), '/renderer/injected.zip')).toEqual({ success: true, data: { saved: true, fileName: 'diagnostics.zip' } });
    expect(mocks.export).toHaveBeenCalledWith('/private/support/diagnostics.zip');
    await invoke(IPC_CHANNELS.DIAGNOSTICS.REVEAL, main(), '/renderer/injected.zip');
    expect(mocks.reveal).toHaveBeenCalledWith('/private/support/diagnostics.zip');
    mocks.save.mockResolvedValueOnce({ canceled: false, filePath: '/private/failed.zip' });
    mocks.export.mockRejectedValueOnce(new Error('/private/secret'));
    const result = await invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT);
    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).not.toContain('/private');
    await invoke(IPC_CHANNELS.DIAGNOSTICS.REVEAL);
    expect(mocks.reveal).toHaveBeenLastCalledWith('/private/support/diagnostics.zip');
  });
  it('serializes exports while a dialog or export is pending', async () => {
    let resolve: (value: { canceled: boolean }) => void = () => undefined;
    mocks.save.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT);
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT)).toMatchObject({ success: false });
    expect(mocks.save).toHaveBeenCalledOnce();
    resolve({ canceled: true });
    await first;
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.EXPORT)).toMatchObject({ success: true });
  });
  it('does not open a URL when feedback is unset, including renderer-supplied URLs', async () => {
    expect(await invoke(IPC_CHANNELS.DIAGNOSTICS.FEEDBACK, main(), 'https://untrusted.example')).toMatchObject({ success: true });
    expect(mocks.external).not.toHaveBeenCalled();
  });
});
