import { ipcMain } from 'electron';
import log from 'electron-log';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult } from '../../shared/types/common';
import { permissionsService } from '../services/permissions';
import { isTrustedSender } from './sender';

const logger = log.scope('permissions-handler');
const permissionSchema = z.enum(['microphone', 'accessibility']);
let handlersRegistered = false;

export function setupPermissionsHandlers(): void {
  if (handlersRegistered) return;
  const operations: [string, (input: unknown) => unknown][] = [
    [IPC_CHANNELS.PERMISSIONS.STATUS, () => ({
      microphone: permissionsService.getMicrophoneStatus(),
      accessibility: permissionsService.getAccessibilityStatus(),
    })],
    [IPC_CHANNELS.PERMISSIONS.REQUEST_MICROPHONE, () => permissionsService.requestMicrophonePermission()],
    [IPC_CHANNELS.PERMISSIONS.OPEN_SETTINGS, input => {
      const type = permissionSchema.parse(input);
      // Register the app in the Accessibility list before opening the pane.
      if (type === 'accessibility') permissionsService.getAccessibilityStatus(true);
      permissionsService.openSettings(type);
    }],
  ];
  for (const [channel, operation] of operations) {
    ipcMain.handle(channel, async (event, input: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      try { return { success: true, data: await operation(input) }; }
      catch (error) {
        logger.warn('Permission operation failed', { error });
        return { success: false, error: '無法處理權限操作' };
      }
    });
  }
  handlersRegistered = true;
}
