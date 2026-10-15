import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, settings } from '../../src/main/db';
import { getSettings, updateSettings } from '../../src/main/services/settings/procedures';
import { getDefaultSettings, MAX_VOCABULARY_TERM_LENGTH, MAX_VOCABULARY_TERMS } from '../../src/main/services/settings/types';

describe('settings', () => {
  let connection: ReturnType<typeof openDatabase>;
  const env = { WHISPER_SERVER_URL: 'http://localhost:9000', WHISPER_LANGUAGE: 'zh' };
  const now = () => 123456789;

  beforeEach(() => {
    connection = openDatabase(':memory:');
    runMigrations(connection.db, path.resolve(__dirname, '../../drizzle'));
  });

  afterEach(() => {
    connection?.sqlite.close();
  });

  it('uses environment defaults without storing them', () => {
    const defaults = getDefaultSettings(env);
    expect(defaults).toEqual({
      history: { enabled: true, saveAudio: false, retentionDays: null },
      asr: { language: 'zh', whisperServerUrl: 'http://localhost:9000', vocabulary: [] },
      input: { autoInsert: true },
      polish: { enabled: false, model: 'Qwen3.5-9B-4bit' },
      command: { enabled: true, model: 'Qwen3.8-27B-oQ4e-mtp' },
    });
    expect(getSettings(connection.db, env)).toEqual({ success: true, data: defaults });
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });

  it('uses built-in defaults when environment values are absent', () => {
    expect(getDefaultSettings({}).asr).toEqual({ language: null, whisperServerUrl: 'http://localhost:8080', vocabulary: [] });
  });

  it.each(['not a URL', 'ftp://localhost:9000', ''])('falls back to localhost:8080 for invalid environment URL %j', (url) => {
    const invalidEnv = { ...env, WHISPER_SERVER_URL: url };
    expect(getDefaultSettings(invalidEnv).asr.whisperServerUrl).toBe('http://localhost:8080');
    expect(getSettings(connection.db, invalidEnv)).toEqual({ success: true, data: getDefaultSettings(invalidEnv) });
  });

  it('lets stored overrides including null language win over environment defaults', () => {
    const patch = {
      history: { enabled: false, saveAudio: true, retentionDays: 30 },
      asr: { language: null, whisperServerUrl: 'https://example.com/whisper', vocabulary: [] },
      input: { autoInsert: false },
      polish: { enabled: true, model: 'custom-model' },
      command: { enabled: false, model: 'custom-command' },
    };
    expect(updateSettings(connection.db, patch, now, env)).toEqual({ success: true, data: patch });
    expect(getSettings(connection.db, env)).toEqual({ success: true, data: patch });
    expect(connection.db.select().from(settings).all()).toHaveLength(11);
    expect(connection.sqlite.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get('asr.language'))
      .toEqual({ value: 'null', updated_at: now() });
  });

  it('defaults polish off and trims model overrides while preserving other settings', () => {
    expect(getDefaultSettings({}).polish).toEqual({ enabled: false, model: 'Qwen3.5-9B-4bit' });
    const result = updateSettings(connection.db, { polish: { enabled: true, model: '  local-model  ' } }, now, env);
    expect(result).toEqual({ success: true, data: { ...getDefaultSettings(env), polish: { enabled: true, model: 'local-model' } } });
    expect(getSettings(connection.db, env)).toEqual(result);
    expect(connection.db.select().from(settings).all()).toHaveLength(2);
    expect(updateSettings(connection.db, { polish: { enabled: false } }, now, env)).toEqual({
      success: true, data: { ...getDefaultSettings(env), polish: { enabled: false, model: 'local-model' } },
    });
  });

  it('defaults command on and persists its model independently of polish', () => {
    expect(getDefaultSettings({}).command).toEqual({ enabled: true, model: 'Qwen3.8-27B-oQ4e-mtp' });
    expect(updateSettings(connection.db, { command: { model: '  command-model  ' } }, now, env)).toEqual({
      success: true, data: { ...getDefaultSettings(env), command: { enabled: true, model: 'command-model' } },
    });
    expect(updateSettings(connection.db, { command: { enabled: false } }, now, env)).toEqual({
      success: true, data: { ...getDefaultSettings(env), command: { enabled: false, model: 'command-model' } },
    });
    expect(connection.db.select().from(settings).all().map(row => row.key).sort()).toEqual(['command.enabled', 'command.model']);
  });

  it('updates only provided keys and persists a null retention override', () => {
    updateSettings(connection.db, { history: { retentionDays: 7 }, asr: { language: 'en' } }, now, env);
    const later = () => now() + 1;
    expect(updateSettings(connection.db, { history: { retentionDays: null } }, later, env)).toEqual({
      success: true,
      data: { ...getDefaultSettings(env), history: { ...getDefaultSettings(env).history, retentionDays: null }, asr: { ...getDefaultSettings(env).asr, language: 'en' } },
    });
    expect(connection.db.select().from(settings).all()).toHaveLength(2);
    expect(connection.sqlite.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get('history.retentionDays'))
      .toEqual({ value: 'null', updated_at: later() });
  });

  it.each([
    { command: { enabled: 'yes' } },
    { command: { model: '' } },
    { command: { model: '   ' } },
    { command: { model: 'a'.repeat(201) } },
    { command: { unknown: true } },
    { polish: { enabled: 'yes' } },
    { polish: { model: '' } },
    { polish: { model: '  ' } },
    { polish: { model: 'a'.repeat(201) } },
    { polish: { model: 123 } },
    { polish: { unknown: true } },
    { unknown: true },
    { history: { unknown: true } },
    { asr: { language: 123 } },
    { asr: { whisperServerUrl: 'invalid' } },
    { history: { retentionDays: 0 } },
    { history: { retentionDays: 1.5 } },
    { input: { autoInsert: 'yes' } },
    { history: { saveAudio: true, enabled: 'yes' } },
    { input: { autoInsert: false }, asr: { whisperServerUrl: 'invalid' } },
  ])('rejects invalid patch %j atomically without storing any field', (patch) => {
    expect(updateSettings(connection.db, patch, now, env).success).toBe(false);
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });

  it('preserves existing overrides and timestamps when a later patch is invalid', () => {
    updateSettings(connection.db, { input: { autoInsert: false } }, now, env);
    const before = connection.db.select().from(settings).all();
    expect(updateSettings(connection.db, { input: { autoInsert: true }, history: { enabled: 0 } }, () => now() + 1, env).success).toBe(false);
    expect(connection.db.select().from(settings).all()).toEqual(before);
  });

  it('ignores corrupt JSON, wrong types and unknown stored keys while applying valid overrides', () => {
    const insert = connection.sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    insert.run('asr.language', '{broken', now());
    insert.run('history.enabled', '"false"', now());
    insert.run('asr.whisperServerUrl', '"invalid"', now());
    insert.run('unknown.key', 'true', now());
    insert.run('history.saveAudio', 'true', now());
    insert.run('input.autoInsert', 'false', now());
    expect(getSettings(connection.db, env)).toEqual({
      success: true,
      data: { ...getDefaultSettings(env), history: { ...getDefaultSettings(env).history, saveAudio: true }, input: { autoInsert: false } },
    });
  });
});

describe('settings asr.vocabulary', () => {
  let connection: ReturnType<typeof openDatabase>;
  const env = { WHISPER_SERVER_URL: 'http://localhost:9000', WHISPER_LANGUAGE: 'zh' };
  const now = () => 123456789;

  beforeEach(() => {
    connection = openDatabase(':memory:');
    runMigrations(connection.db, path.resolve(__dirname, '../../drizzle'));
  });

  afterEach(() => {
    connection?.sqlite.close();
  });

  it('defaults to an empty list without storing it', () => {
    const result = getSettings(connection.db, env);
    expect(result.success).toBe(true);
    if (result.success === true) expect(result.data.asr.vocabulary).toEqual([]);
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });

  it('stores and reads back a list with terms trimmed by validation', () => {
    const vocabulary = ['Jeris', 'Open Typeless', '自訂詞彙'];
    const expected = { success: true, data: { ...getDefaultSettings(env), asr: { ...getDefaultSettings(env).asr, vocabulary } } };
    expect(updateSettings(connection.db, { asr: { vocabulary: [' Jeris ', '\tOpen Typeless\n', ' 自訂詞彙 '] } }, now, env))
      .toEqual(expected);
    expect(getSettings(connection.db, env)).toEqual(expected);
    expect(connection.db.select().from(settings).all()).toHaveLength(1);
    expect(connection.sqlite.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get('asr.vocabulary'))
      .toEqual({ value: JSON.stringify(vocabulary), updated_at: now() });
  });

  it.each([
    { name: 'an empty-string term', vocabulary: ['Jeris', ''] },
    { name: 'a whitespace-only term', vocabulary: ['Jeris', ' \t\n '] },
    { name: 'a term longer than the length limit', vocabulary: ['A'.repeat(MAX_VOCABULARY_TERM_LENGTH + 1)] },
    { name: 'more terms than the count limit', vocabulary: Array.from({ length: MAX_VOCABULARY_TERMS + 1 }, (_, index) => `term-${index}`) },
    { name: 'a non-array value', vocabulary: 'Jeris' },
  ])('rejects $name without writing any field', ({ vocabulary }) => {
    expect(updateSettings(connection.db, { asr: { vocabulary }, input: { autoInsert: false } }, now, env).success)
      .toBe(false);
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });

  it('ignores a corrupt stored vocabulary and falls back to an empty list', () => {
    connection.sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('asr.vocabulary', '"not an array"', now());
    expect(getSettings(connection.db, env)).toEqual({ success: true, data: getDefaultSettings(env) });
  });
});
