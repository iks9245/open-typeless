import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';
import { registerTrustedWindow } from '../../src/main/ipc/sender';
import { mockIpcEvent, mockWebContents } from './security-mocks';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), list: vi.fn(), ensure: vi.fn(), open: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, shell: { openPath: mocks.open } }));
vi.mock('../../src/main/services/whisper-server', () => ({
  listWhisperModels: mocks.list, ensureModelsFolder: mocks.ensure, whisperServerService: { status: vi.fn() },
}));
import { setupWhisperServerHandlers } from '../../src/main/ipc/whisper-server.handler';
setupWhisperServerHandlers();
type Handler = (event: IpcMainInvokeEvent) => unknown;
const handlers = new Map<string, Handler>(mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
const invoke = (channel: string, event: IpcMainInvokeEvent) => handlers.get(channel)?.(event);
const models = [{ id: 'app/cantonese.bin', source: 'app', fileName: 'cantonese.bin', sizeBytes: 100 }];

function mainEvent() {
  const { webContents } = mockWebContents('file:///app/index.html');
  registerTrustedWindow(webContents, 'main');
  return mockIpcEvent(webContents);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue(models);
  mocks.ensure.mockReturnValue('/private/user/models');
  mocks.open.mockResolvedValue('');
});

describe('whisper model IPC', () => {
  it('registers all three channels once', () => {
    expect([...handlers.keys()]).toEqual(Object.values(IPC_CHANNELS.WHISPER_SERVER));
    setupWhisperServerHandlers();
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it('returns model names, ids and sizes without paths', () => {
    const result = invoke(IPC_CHANNELS.WHISPER_SERVER.MODELS, mainEvent());
    expect(result).toEqual({ success: true, data: models });
    expect(JSON.stringify(result)).not.toContain('/private/');
  });

  it('creates and opens the models folder without returning its path', async () => {
    expect(await invoke(IPC_CHANNELS.WHISPER_SERVER.OPEN_MODELS_FOLDER, mainEvent())).toEqual({ success: true, data: undefined });
    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith('/private/user/models');
  });

  it.each(['unregistered', 'floating', 'subframe'] as const)('rejects %s senders', async kind => {
    const { webContents } = mockWebContents('file:///app/index.html');
    if (kind === 'floating') registerTrustedWindow(webContents, 'floating');
    if (kind === 'subframe') registerTrustedWindow(webContents, 'main');
    const event = mockIpcEvent(webContents, kind === 'subframe' ? null : webContents.mainFrame);
    for (const channel of handlers.keys()) expect(await invoke(channel, event)).toEqual({ success: false, error: 'Untrusted sender' });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('keeps OS error paths out of IPC responses', async () => {
    mocks.open.mockResolvedValueOnce('cannot open /private/user/models');
    expect(await invoke(IPC_CHANNELS.WHISPER_SERVER.OPEN_MODELS_FOLDER, mainEvent())).toEqual({ success: false, error: '無法打開模型資料夾' });
    mocks.ensure.mockImplementationOnce(() => { throw new Error('/private/user/models'); });
    expect(await invoke(IPC_CHANNELS.WHISPER_SERVER.OPEN_MODELS_FOLDER, mainEvent())).toEqual({ success: false, error: 'Internal error' });
    mocks.list.mockImplementationOnce(() => { throw new Error('/private/user/models'); });
    expect(invoke(IPC_CHANNELS.WHISPER_SERVER.MODELS, mainEvent())).toEqual({ success: false, error: 'Internal error' });
  });
});
