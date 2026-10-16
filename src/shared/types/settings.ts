/**
 * Application settings shared with the renderer.
 * Runtime validation belongs to the main-process settings service.
 */

import type { TriggerKeyId } from '../constants/keyboard';

export const ONBOARDING_STEPS = ['welcome', 'model', 'microphone', 'accessibility', 'try', 'ai', 'done'] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
export type PrimaryLanguage = 'yue' | 'zh' | 'en' | 'other';

export interface AppSettings {
  onboarding: { migratedFromLegacy: boolean; completed: boolean; step: OnboardingStep | null; primaryLanguage: PrimaryLanguage | null };
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
  onboarding?: Partial<AppSettings['onboarding']>;
  memory?: Partial<AppSettings['memory']>;
  history?: Partial<AppSettings['history']>;
  asr?: Partial<AppSettings['asr']>;
  polish?: Partial<AppSettings['polish']>;
  command?: Partial<AppSettings['command']>;
  input?: Partial<AppSettings['input']>;
}
