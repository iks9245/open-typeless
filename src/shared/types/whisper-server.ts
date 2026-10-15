/**
 * Renderer-safe view of the local whisper.cpp server.
 * File names only: full paths and process IDs stay in the main process.
 */

export interface WhisperServerInfo {
  /** managed: started by the app; adopted: left by an earlier launch; external: started by someone else */
  mode: 'managed' | 'adopted' | 'external' | 'unavailable' | 'none';
  state: 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';
  /** Why the server is unavailable or failed */
  reason: string | null;
  binaryName: string | null;
  modelName: string | null;
  vadModelName: string | null;
}
