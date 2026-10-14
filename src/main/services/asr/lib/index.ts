/**
 * ASR library exports.
 * Re-exports client and configuration utilities.
 */

export { VolcengineClient } from './volcengine-client';
export type { VolcengineClientEvents } from './volcengine-client';

export {
  loadASRConfig,
  isASRConfigured,
  ConfigurationError,
} from './config';
// Keep the old name so existing re-exports compile without change
export type { VolcengineEnvConfig as ASREnvConfig } from './config';
