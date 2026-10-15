/**
 * Shared constants.
 * Re-exports all constants for convenient importing.
 */

export { IPC_CHANNELS } from './channels';
export { DEFAULT_POLISH_MODEL, RECOMMENDED_POLISH_MODELS } from './polish';
export {
  TRANSCRIPTION_STATUSES,
  TRANSCRIPTION_MODES,
  INSERT_STATUSES,
  ASR_ENGINES,
} from './history';
export type {
  TranscriptionStatus,
  TranscriptionMode,
  InsertStatus,
  ASREngine,
} from './history';

export { TRIGGER_KEYS, triggerKeyLabel, type TriggerKeyId } from './keyboard';
