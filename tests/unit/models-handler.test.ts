import { EventEmitter } from 'node:events';
import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/constants/channels';
import { registerTrustedWindow } from '../../src/main/ipc/sender';
import { ModelDownloadError } from '../../src/main/services/model-download/model-download.service';
import { mockIpcEvent, mockWebContents } from './security-mocks';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), windows: vi.fn(), catalog: vi.fn(), start: vi.fn(), cancel: vi.fn(), discard: vi.fn(), delete: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, BrowserWindow: { getAllWindows: mocks.windows } }));
const service = Object.assign(new EventEmitter(), { catalog: mocks.catalog, start: mocks.start, cancel: mocks.cancel, discard: mocks.discard, delete: mocks.delete });
vi.mock('../../src/main/services/model-download', () => ({ getModelDownloadService: () => service }));
import { setupModelsHandlers } from '../../src/main/ipc/models.handler';

type Handler = (event: IpcMainInvokeEvent, input?: unknown) => Promise<unknown>;
let handlers: Map<string, Handler>;
const invoke = (channel: string, event: IpcMainInvokeEvent, input?: unknown) => handlers.get(channel)?.(event, input);
function windowFor(role?: 'main' | 'floating') {
  const { webContents } = mockWebContents('file:///app/index.html');
  if (role) registerTrustedWindow(webContents, role);
  const send = vi.fn();
  Object.assign(webContents, { send });
  return { webContents, send, event: mockIpcEvent(webContents), isDestroyed: () => false };
}

beforeEach(() => {
  vi.clearAllMocks();
  if (!handlers) {
    setupModelsHandlers();
    handlers = new Map(mocks.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
  }
  mocks.catalog.mockResolvedValue([{ key: 'large-v3-turbo', fileName: 'ggml-large-v3-turbo.bin', installed: true, modelId: 'app/ggml-large-v3-turbo.bin' }]);
  mocks.windows.mockReturnValue([]);
});

describe('model management IPC', () => {
  it('registers exactly the five invoke channels, once', () => {
    expect([...handlers.keys()]).toEqual(Object.values(IPC_CHANNELS.MODELS).filter(channel => channel !== IPC_CHANNELS.MODELS.DOWNLOAD_PROGRESS));
    const calls = mocks.handle.mock.calls.length;
    setupModelsHandlers();
    expect(mocks.handle.mock.calls.length).toBe(calls);
  });

  it('returns only model names and relative IDs', async () => {
    const result = await invoke(IPC_CHANNELS.MODELS.CATALOG, windowFor('main').event);
    expect(result).toEqual({ success: true, data: await mocks.catalog() });
    expect(JSON.stringify(result)).not.toContain('/private/');
  });

  it.each(['unregistered', 'floating', 'subframe'] as const)('rejects %s for every operation', async kind => {
    const window = windowFor(kind === 'floating' ? 'floating' : kind === 'subframe' ? 'main' : undefined);
    const event = kind === 'subframe' ? mockIpcEvent(window.webContents, null) : window.event;
    for (const channel of handlers.keys()) expect(await invoke(channel, event, 'large-v3-turbo')).toEqual({ success: false, error: 'Untrusted sender' });
    for (const operation of [mocks.catalog, mocks.start, mocks.cancel, mocks.discard, mocks.delete]) expect(operation).not.toHaveBeenCalled();
  });

  it('validates keys and model IDs before calling the service', async () => {
    const event = windowFor('main').event;
    for (const input of [null, 123, {}, '../outside', 'https://evil/?secret=1']) {
      expect(await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_START, event, input)).toMatchObject({ success: false });
      expect(await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_DISCARD, event, input)).toMatchObject({ success: false });
    }
    expect(await invoke(IPC_CHANNELS.MODELS.DELETE, event, 'app/../outside.bin')).toMatchObject({ success: false });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('forwards valid operations and sanitizes unexpected errors', async () => {
    const event = windowFor('main').event;
    expect(await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_START, event, 'large-v3-turbo')).toMatchObject({ success: true });
    expect(mocks.start).toHaveBeenCalledWith('large-v3-turbo');
    await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_CANCEL, event);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_DISCARD, event, 'large-v3-turbo');
    expect(mocks.discard).toHaveBeenCalledWith('large-v3-turbo');
    await invoke(IPC_CHANNELS.MODELS.DELETE, event, 'app/ggml-test.bin');
    expect(mocks.delete).toHaveBeenCalledWith('app/ggml-test.bin');
    mocks.start.mockImplementationOnce(() => { throw new ModelDownloadError('未知的模型'); });
    expect(await invoke(IPC_CHANNELS.MODELS.DOWNLOAD_START, event, 'unknown')).toEqual({ success: false, error: '未知的模型' });
    mocks.catalog.mockRejectedValueOnce(new Error('/private/user/models https://cdn/?token=secret'));
    expect(await invoke(IPC_CHANNELS.MODELS.CATALOG, event)).toEqual({ success: false, error: '無法處理模型操作' });
  });

  it('sends progress only to registered main windows', () => {
    const main = windowFor('main');
    const floating = windowFor('floating');
    const unknown = windowFor();
    mocks.windows.mockReturnValue([main, floating, unknown]);
    const progress = { key: 'large-v3-turbo', fileName: 'ggml-large-v3-turbo.bin', state: 'downloading', receivedBytes: 100, totalBytes: 1000, bytesPerSecond: 10, etaSeconds: 90, error: null };
    service.emit('progress', progress);
    expect(main.send).toHaveBeenCalledWith('models:download-progress', progress);
    expect(floating.send).not.toHaveBeenCalled();
    expect(unknown.send).not.toHaveBeenCalled();
    expect(JSON.stringify(main.send.mock.calls)).not.toContain('/private/');
  });
});
