import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { memoryService } from '../services/memory';
import { getTrustedWebContents, isTrustedSender } from './sender';

let registered = false;
export function setupMemoryHandlers(): void {
  if (registered) return;
  const channels = IPC_CHANNELS.MEMORY;
  for (const [channel, run] of [
    [channels.ASK, (input: unknown) => memoryService.ask(input)],
    [channels.STATUS, () => ({ success: true, data: memoryService.status() })],
    [channels.REINDEX, () => memoryService.reindex()],
    [channels.HISTORY, () => ({ success: true, data: memoryService.history() })],
  ] as const) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      try { return await run(input); }
      catch { return { success: false, error: 'Memory operation failed' }; }
    });
  }
  memoryService.onAnswered(entry => getTrustedWebContents('main')?.send(channels.ANSWERED, entry));
  registered = true;
}
