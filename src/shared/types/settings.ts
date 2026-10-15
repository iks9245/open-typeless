/**
 * Application settings shared with the renderer.
 * Runtime validation belongs to the main-process settings service.
 */

import type { TriggerKeyId } from '../constants/keyboard';

export interface AppSettings {
  memory: { enabled: boolean };
  history: {
    enabled: boolean;
    saveAudio: boolean;
    retentionDays: number | null;
  };
  asr: {
    /** Model catalog id; null preserves automatic discovery. */
    model: string | null;
    language: string | null;
    whisperServerUrl: string;
    /** Proper nouns and terms that recognition should favor */
    vocabulary: string[];
  };
  polish: {
    enabled: boolean;
    model: string;
    style: 'auto' | 'standard' | 'cantonese';
  };
  command: {
    enabled: boolean;
    model: string;
  };
  input: {
    autoInsert: boolean;
    triggerKey: TriggerKeyId;
  };
}

export interface AppSettingsPatch {
  memory?: Partial<AppSettings['memory']>;
  history?: Partial<AppSettings['history']>;
  asr?: Partial<AppSettings['asr']>;
  polish?: Partial<AppSettings['polish']>;
  command?: Partial<AppSettings['command']>;
  input?: Partial<AppSettings['input']>;
}
