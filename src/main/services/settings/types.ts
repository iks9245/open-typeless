/**
 * Settings validation and defaults.
 * Maps supported dotted storage keys to their runtime schemas.
 */

import log from 'electron-log';
import { z } from 'zod';
import type { AppSettings, AppSettingsPatch } from '../../../shared/types/settings';
import { DEFAULT_COMMAND_MODEL } from '../../../shared/constants/command';
import { DEFAULT_POLISH_MODEL } from '../../../shared/constants/polish';
import { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH } from '../../../shared/lib/vocabulary-prompt';

const logger = log.scope('settings:types');

export type SettingsResult<T> = { success: true; data: T } | { success: false; error: string };
export type SettingsEnvironment = Readonly<Record<string, string | undefined>>;

export interface SettingsService {
  get(input?: unknown): SettingsResult<AppSettings>;
  update(patch: unknown): SettingsResult<AppSettings>;
  on(event: 'changed', listener: (settings: AppSettings) => void): SettingsService;
  off(event: 'changed', listener: (settings: AppSettings) => void): SettingsService;
}

const historySchema = z.object({
  enabled: z.boolean(),
  saveAudio: z.boolean(),
  retentionDays: z.number().int().positive().nullable(),
}).strict();

export { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH };

const asrSchema = z.object({
  language: z.string().nullable(),
  whisperServerUrl: z.string().url().refine(
    (value) => /^https?:\/\//i.test(value),
    'Whisper server URL must use http or https',
  ),
  // Terms sent to whisper as a prompt to bias recognition (see shared/lib/vocabulary-prompt.ts)
  vocabulary: z.array(z.string().trim().min(1).max(MAX_VOCABULARY_TERM_LENGTH))
    .max(MAX_VOCABULARY_TERMS),
}).strict();

const inputSchema = z.object({ autoInsert: z.boolean() }).strict();
const polishSchema = z.object({
  enabled: z.boolean(),
  model: z.string().trim().min(1).max(200),
}).strict();

export const appSettingsSchema: z.ZodType<AppSettings> = z.object({
  history: historySchema,
  asr: asrSchema,
  input: inputSchema,
  polish: polishSchema,
  command: polishSchema,
}).strict();

export const settingsPatchSchema: z.ZodType<AppSettingsPatch> = z.object({
  history: historySchema.partial().optional(),
  asr: asrSchema.partial().optional(),
  input: inputSchema.partial().optional(),
  polish: polishSchema.partial().optional(),
  command: polishSchema.partial().optional(),
}).strict();

export const emptySettingsInputSchema = z.object({}).strict();

export const settingSchemas = {
  'history.enabled': historySchema.shape.enabled,
  'history.saveAudio': historySchema.shape.saveAudio,
  'history.retentionDays': historySchema.shape.retentionDays,
  'asr.language': asrSchema.shape.language,
  'asr.whisperServerUrl': asrSchema.shape.whisperServerUrl,
  'asr.vocabulary': asrSchema.shape.vocabulary,
  'input.autoInsert': inputSchema.shape.autoInsert,
  'command.enabled': polishSchema.shape.enabled,
  'command.model': polishSchema.shape.model,
  'polish.enabled': polishSchema.shape.enabled,
  'polish.model': polishSchema.shape.model,
};

export type SettingKey = keyof typeof settingSchemas;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(settingSchemas, key);
}

export function applySetting(target: AppSettings, key: SettingKey, value: unknown): void {
  // Values have already been checked with the matching dotted-key schema.
  switch (key) {
    case 'history.enabled': target.history.enabled = value as boolean; break;
    case 'history.saveAudio': target.history.saveAudio = value as boolean; break;
    case 'history.retentionDays': target.history.retentionDays = value as number | null; break;
    case 'asr.language': target.asr.language = value as string | null; break;
    case 'asr.whisperServerUrl': target.asr.whisperServerUrl = value as string; break;
    case 'asr.vocabulary': target.asr.vocabulary = value as string[]; break;
    case 'input.autoInsert': target.input.autoInsert = value as boolean; break;
    case 'command.enabled': target.command.enabled = value as boolean; break;
    case 'command.model': target.command.model = value as string; break;
    case 'polish.enabled': target.polish.enabled = value as boolean; break;
    case 'polish.model': target.polish.model = value as string; break;
  }
}

export function getDefaultSettings(env: SettingsEnvironment = process.env): AppSettings {
  const url = asrSchema.shape.whisperServerUrl.safeParse(env.WHISPER_SERVER_URL ?? 'http://localhost:8080');
  if (url.success === false) {
    logger.warn('Ignoring invalid WHISPER_SERVER_URL', { error: url.error.issues[0].message });
  }
  return {
    history: { enabled: true, saveAudio: false, retentionDays: null },
    asr: {
      language: env.WHISPER_LANGUAGE ?? null,
      whisperServerUrl: url.success === true ? url.data : 'http://localhost:8080',
      vocabulary: [],
    },
    input: { autoInsert: true },
    polish: { enabled: false, model: DEFAULT_POLISH_MODEL },
    command: { enabled: true, model: DEFAULT_COMMAND_MODEL },
  };
}
