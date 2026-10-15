import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIpcEvent, mockWebContents } from './security-mocks';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';
import { registerTrustedWindow } from '../../src/main/ipc/sender';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/services/login-item', () => ({ loginItemService: { get: mocks.get, set: mocks.set } }));
import { setupSystemHandlers } from '../../src/main/ipc/system.handler';

setupSystemHandlers();
type Handler = (event: IpcMainInvokeEvent, input?: unknown) => unknown;
const handlers = new Map<string, Handler>(mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
const invoke = (channel: string, event: IpcMainInvokeEvent, input?: unknown) => handlers.get(channel)?.(event, input);
const state = { supported: true, enabled: false, requiresApproval: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(state);
  mocks.set.mockReturnValue(state);
});

function mainEvent() {
  const { webContents } = mockWebContents('file:///app/index.html');
  registerTrustedWindow(webContents, 'main');
  return mockIpcEvent(webContents);
}

describe('system login-item IPC', () => {
  it('registers both channels once', () => {
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.SYSTEM.GET_LOGIN_ITEM, IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM]);
    setupSystemHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('returns OS state and passes validated booleans to the service', () => {
    const event = mainEvent();
    expect(invoke(IPC_CHANNELS.SYSTEM.GET_LOGIN_ITEM, event)).toEqual({ success: true, data: state });
    for (const enabled of [true, false]) {
      expect(invoke(IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM, event, enabled)).toEqual({ success: true, data: state });
      expect(mocks.set).toHaveBeenLastCalledWith(enabled);
    }
  });

  it.each(['true', 1, null, undefined, { enabled: true }])('rejects invalid boolean %j before accessing OS state', input => {
    expect(invoke(IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM, mainEvent(), input)).toMatchObject({ success: false });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each(['unregistered', 'floating', 'subframe'] as const)('rejects %s senders on both channels', kind => {
    const { webContents } = mockWebContents('file:///app/index.html');
    if (kind === 'floating') registerTrustedWindow(webContents, 'floating');
    if (kind === 'subframe') registerTrustedWindow(webContents, 'main');
    const event = mockIpcEvent(webContents, kind === 'subframe' ? null : webContents.mainFrame);
    for (const channel of handlers.keys()) {
      expect(invoke(channel, event, true)).toEqual({ success: false, error: 'Untrusted sender' });
    }
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('returns a fixed error when the OS call fails', () => {
    mocks.get.mockImplementationOnce(() => { throw new Error('private OS details'); });
    expect(invoke(IPC_CHANNELS.SYSTEM.GET_LOGIN_ITEM, mainEvent())).toEqual({ success: false, error: 'Internal error' });
    mocks.set.mockImplementationOnce(() => { throw new Error('private OS details'); });
    expect(invoke(IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM, mainEvent(), true)).toEqual({ success: false, error: 'Internal error' });
  });
});
