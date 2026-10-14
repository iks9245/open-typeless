/**
 * Common IPC response types shared by main and renderer processes.
 */

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string };
