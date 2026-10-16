import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, runMigrations, settings, transcriptions } from '../../src/main/db';
import { migrateExistingUser, resetMigratedPermissions } from '../../src/main/services/onboarding';
import { getSettings, updateSettings } from '../../src/main/services/settings/procedures';
import { isRecentOnboardingTrial, onboardingRecommendations } from '../../src/shared/lib/onboarding';
import { ONBOARDING_STEPS } from '../../src/shared/types/settings';

describe('onboarding recommendations', () => {
  it.each(['yue', 'zh', 'en', 'other', null] as const)('recommends recognition and style for %s', language => {
    expect(onboardingRecommendations(language, 16)).toMatchObject({
      catalogKey: language === 'yue' ? 'large-v3-cantonese-q8_0' : 'large-v3-turbo',
      asrLanguage: null, polishStyle: 'standard', polishModel: 'Qwen3.5-9B-4bit',
    });
  });
  it.each([
    { memory: 4, light: true, largeCommand: false },
    { memory: 7.99, light: true, largeCommand: false },
    { memory: 8, light: false, largeCommand: false },
    { memory: 31.99, light: false, largeCommand: false },
    { memory: 32, light: false, largeCommand: true },
    { memory: 64, light: false, largeCommand: true },
    { memory: null, light: false, largeCommand: false },
  ])('uses exact memory thresholds at $memory GB', ({ memory, light, largeCommand }) => {
    const result = onboardingRecommendations('yue', memory);
    expect(result.catalogKey).toBe('large-v3-cantonese-q8_0');
    expect(result.lighterCatalogKey).toBe(light ? 'large-v3-turbo-q5_0' : null);
    expect(result.commandModel).toBe(largeCommand ? 'Qwen3.8-27B-oQ4e-mtp' : 'Qwen3.5-9B-4bit');
    expect(result.commandsLessReliable).toBe(!largeCommand);
  });
});

describe('onboarding persistence and migration', () => {
  let connection: ReturnType<typeof openDatabase>;
  const now = () => 123456;
  const read = () => {
    const result = getSettings(connection.db, {});
    if (result.success === false) throw new Error(result.error);
    return result.data.onboarding;
  };
  const seedHistory = () => connection.db.insert(transcriptions).values({
    id: 'old', createdAt: 1, updatedAt: 1, status: 'failed', engine: 'whisper.cpp', appVersion: '1',
  }).run();

  beforeEach(() => {
    connection = openDatabase(':memory:');
    runMigrations(connection.db, path.resolve('drizzle'));
  });
  afterEach(() => connection.sqlite.close());

  it('leaves an empty history incomplete without storing a completed row', () => {
    migrateExistingUser(connection.db, now);
    expect(read()).toEqual({ completed: false, step: null, primaryLanguage: null, migratedFromLegacy: false });
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });
  it('marks any existing history as complete exactly once', () => {
    seedHistory();
    migrateExistingUser(connection.db, now);
    expect(read().completed).toBe(true);
    migrateExistingUser(connection.db, () => 999999);
    expect(connection.db.select().from(settings).all()).toEqual([{ key: 'onboarding.completed', value: true, updatedAt: now() }]);
  });
  it.each([true, false])('preserves a stored completed=%s and resumable step despite history', completed => {
    seedHistory();
    updateSettings(connection.db, { onboarding: { completed, step: 'try', primaryLanguage: 'yue' } }, now, {});
    const before = connection.db.select().from(settings).all();
    migrateExistingUser(connection.db, () => 999999);
    expect(connection.db.select().from(settings).all()).toEqual(before);
    expect(read()).toEqual({ completed, step: 'try', primaryLanguage: 'yue', migratedFromLegacy: false });
  });
  it('preserves even an invalid stored completed row instead of inferring a new user choice', () => {
    seedHistory();
    connection.sqlite.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('onboarding.completed', '"invalid"', 1);
    migrateExistingUser(connection.db, now);
    expect(connection.db.select().from(settings).where(eq(settings.key, 'onboarding.completed')).get()?.value).toBe('invalid');
    expect(read().completed).toBe(false);
  });
  it.each([...ONBOARDING_STEPS, null])('persists and resumes step %s without losing other settings', step => {
    const result = updateSettings(connection.db, { onboarding: { step }, input: { autoInsert: false } }, now, {});
    expect(result.success).toBe(true);
    expect(read()).toEqual({ completed: false, step, primaryLanguage: null, migratedFromLegacy: false });
    expect(getSettings(connection.db, {})).toEqual(result);
  });
  it.each([true, false])('resets migrated permissions only for completed=%s', completed => {
    updateSettings(connection.db, {
      onboarding: { completed, step: 'try', primaryLanguage: 'yue' },
      asr: { vocabulary: ['WaaE'], model: 'app/ggml-base.bin' }, input: { autoInsert: false },
    }, now, {});
    const before = getSettings(connection.db, {});
    resetMigratedPermissions(connection.db, () => 999999);
    expect(read()).toEqual({
      completed: false, step: completed ? 'microphone' : 'try', primaryLanguage: 'yue', migratedFromLegacy: completed,
    });
    const after = getSettings(connection.db, {});
    if (!before.success || !after.success) throw new Error('settings unavailable');
    expect({ ...after.data, onboarding: before.data.onboarding }).toEqual(before.data);
    // An interrupted permission wizard must resume without resetting its progress.
    updateSettings(connection.db, { onboarding: { step: 'accessibility' } }, now, {});
    resetMigratedPermissions(connection.db, now);
    expect(read().step).toBe('accessibility');
  });
  it('does not set migration flags for missing or invalid completion; clears the flag at done', () => {
    resetMigratedPermissions(connection.db, now);
    expect(read().migratedFromLegacy).toBe(false);
    connection.sqlite.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('onboarding.completed', '"true"', 1);
    resetMigratedPermissions(connection.db, now);
    expect(read().migratedFromLegacy).toBe(false);
    updateSettings(connection.db, { onboarding: { completed: true } }, now, {});
    resetMigratedPermissions(connection.db, now);
    expect(read().migratedFromLegacy).toBe(true);
    updateSettings(connection.db, { onboarding: { completed: true, step: null, migratedFromLegacy: false } }, now, {});
    expect(read()).toEqual({ completed: true, step: null, primaryLanguage: null, migratedFromLegacy: false });
  });
  it.each(['yue', 'zh', 'en', 'other', null])('persists primary language %s', primaryLanguage => {
    expect(updateSettings(connection.db, { onboarding: { primaryLanguage } }, now, {}).success).toBe(true);
    expect(read().primaryLanguage).toBe(primaryLanguage);
  });
  it.each([
    { step: 'invalid' }, { step: 1 }, { step: true }, { completed: 'true' }, { completed: null },
    { migratedFromLegacy: 'true' }, { migratedFromLegacy: null }, { primaryLanguage: 'ja' }, { primaryLanguage: 1 }, { unknown: true },
  ])('rejects invalid onboarding %j atomically', onboarding => {
    expect(updateSettings(connection.db, { onboarding, input: { autoInsert: false } }, now, {}).success).toBe(false);
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });
  it('supports completion, rerun and language application atomically', () => {
    const recommendation = onboardingRecommendations('yue', 8);
    updateSettings(connection.db, {
      onboarding: { primaryLanguage: 'yue', step: 'model' },
      asr: { language: recommendation.asrLanguage }, polish: { style: recommendation.polishStyle },
    }, now, { WHISPER_LANGUAGE: 'zh' });
    updateSettings(connection.db, { onboarding: { completed: true, step: null } }, now, {});
    expect(read()).toEqual({ primaryLanguage: 'yue', completed: true, step: null, migratedFromLegacy: false });
    seedHistory();
    updateSettings(connection.db, { onboarding: { completed: false, step: 'welcome' } }, now, {});
    migrateExistingUser(connection.db, now);
    expect(read()).toEqual({ primaryLanguage: 'yue', completed: false, step: 'welcome', migratedFromLegacy: false });
    const result = getSettings(connection.db, {});
    expect(result).toMatchObject({ success: true, data: { asr: { language: null }, polish: { style: 'standard' } } });
  });
});

describe('onboarding trial history freshness', () => {
  const now = 1000000;
  it.each([0, 1, 59999, 60000])('accepts nonempty dictation completed %s ms ago', age => {
    expect(isRecentOnboardingTrial({ status: 'completed', finalText: '  你好  ', updatedAt: now - age }, now)).toBe(true);
  });
  it.each([60001, 120000, -1])('rejects stale or future completions (%s ms)', age => {
    expect(isRecentOnboardingTrial({ status: 'completed', finalText: '你好', updatedAt: now - age }, now)).toBe(false);
  });
  it.each(['recording', 'processing', 'empty', 'failed'] as const)('rejects %s rows', status => {
    expect(isRecentOnboardingTrial({ status, finalText: '你好', updatedAt: now }, now)).toBe(false);
  });
  it.each(['', '  ', null])('rejects empty final text %j', finalText => {
    expect(isRecentOnboardingTrial({ status: 'completed', finalText, updatedAt: now }, now)).toBe(false);
  });
  it('handles an empty history', () => { expect(isRecentOnboardingTrial(undefined, now)).toBe(false); });
});
