import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';
import { registerTrustedWindow } from '../../src/main/ipc/sender';
import { mockIpcEvent, mockWebContents } from './security-mocks';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), microphone: vi.fn(), accessibility: vi.fn(), request: vi.fn(), open: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/services/permissions', () => ({ permissionsService: {
  getMicrophoneStatus: mocks.microphone, getAccessibilityStatus: mocks.accessibility,
  requestMicrophonePermission: mocks.request, openSettings: mocks.open,
} }));
import { setupPermissionsHandlers } from '../../src/main/ipc/permissions.handler';

setupPermissionsHandlers();
type Handler = (event: IpcMainInvokeEvent, input?: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>(mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
const invoke = (channel: string, event: IpcMainInvokeEvent, input?: unknown) => handlers.get(channel)?.(event, input);
const event = (role: 'main' | 'floating' | undefined = 'main', subframe = false) => {
  const { webContents } = mockWebContents('file:///app/index.html');
  if (role) registerTrustedWindow(webContents, role);
  return mockIpcEvent(webContents, subframe ? null : webContents.mainFrame);
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.microphone.mockReturnValue('denied');
  mocks.accessibility.mockReturnValue(false);
  mocks.request.mockResolvedValue(false);
});

describe('onboarding permission IPC', () => {
  it('registers all permission channels once', () => {
    expect([...handlers.keys()]).toEqual(Object.values(IPC_CHANNELS.PERMISSIONS));
    setupPermissionsHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
  });
  it('checks status without prompting and requests microphone only explicitly', async () => {
    expect(await invoke(IPC_CHANNELS.PERMISSIONS.STATUS, event())).toEqual({ success: true, data: { microphone: 'denied', accessibility: false } });
    expect(mocks.accessibility).toHaveBeenCalledWith();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await invoke(IPC_CHANNELS.PERMISSIONS.REQUEST_MICROPHONE, event())).toEqual({ success: true, data: false });
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it.each(['microphone', 'accessibility'])('opens the validated %s pane, listing the app before Accessibility opens', async type => {
    expect(await invoke(IPC_CHANNELS.PERMISSIONS.OPEN_SETTINGS, event(), type)).toMatchObject({ success: true });
    expect(mocks.open).toHaveBeenCalledWith(type);
    if (type === 'accessibility') {
      expect(mocks.accessibility).toHaveBeenCalledWith(true);
      expect(mocks.accessibility.mock.invocationCallOrder[0]).toBeLessThan(mocks.open.mock.invocationCallOrder[0]);
    } else expect(mocks.accessibility).not.toHaveBeenCalled();
  });
  it.each(['inputMonitoring', 'camera', 'https://example.com', '', null, undefined, {}, { type: 'microphone' }])('rejects invalid pane %j', async input => {
    expect(await invoke(IPC_CHANNELS.PERMISSIONS.OPEN_SETTINGS, event(), input)).toMatchObject({ success: false });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.accessibility).not.toHaveBeenCalled();
  });
  it.each(['floating', 'unknown', 'subframe'] as const)('rejects %s senders on every channel', async kind => {
    const sender = event(kind === 'floating' ? 'floating' : 'main', kind === 'subframe');
    const unregistered = mockWebContents('file:///app/index.html');
    for (const channel of handlers.keys()) {
      expect(await invoke(channel, kind === 'unknown' ? mockIpcEvent(unregistered.webContents) : sender, 'accessibility'))
        .toEqual({ success: false, error: 'Untrusted sender' });
    }
    for (const mock of [mocks.microphone, mocks.accessibility, mocks.request, mocks.open]) expect(mock).not.toHaveBeenCalled();
  });
  it('sanitizes OS exceptions', async () => {
    mocks.request.mockRejectedValueOnce(new Error('/private/internal'));
    expect(await invoke(IPC_CHANNELS.PERMISSIONS.REQUEST_MICROPHONE, event())).toEqual({ success: false, error: '無法處理權限操作' });
  });
});
