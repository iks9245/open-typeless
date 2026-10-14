import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, settings } from '../../src/main/db';
import { getSettings, updateSettings } from '../../src/main/services/settings/procedures';
import { getDefaultSettings } from '../../src/main/services/settings/types';

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
      asr: { language: 'zh', whisperServerUrl: 'http://localhost:9000' },
      input: { autoInsert: true },
    });
    expect(getSettings(connection.db, env)).toEqual({ success: true, data: defaults });
    expect(connection.db.select().from(settings).all()).toEqual([]);
  });

  it('uses built-in defaults when environment values are absent', () => {
    expect(getDefaultSettings({}).asr).toEqual({ language: null, whisperServerUrl: 'http://localhost:8080' });
  });

  it.each(['not a URL', 'ftp://localhost:9000', ''])('falls back to localhost:8080 for invalid environment URL %j', (url) => {
    const invalidEnv = { ...env, WHISPER_SERVER_URL: url };
    expect(getDefaultSettings(invalidEnv).asr.whisperServerUrl).toBe('http://localhost:8080');
    expect(getSettings(connection.db, invalidEnv)).toEqual({ success: true, data: getDefaultSettings(invalidEnv) });
  });

  it('lets stored overrides including null language win over environment defaults', () => {
    const patch = {
      history: { enabled: false, saveAudio: true, retentionDays: 30 },
      asr: { language: null, whisperServerUrl: 'https://example.com/whisper' },
      input: { autoInsert: false },
    };
    expect(updateSettings(connection.db, patch, now, env)).toEqual({ success: true, data: patch });
    expect(getSettings(connection.db, env)).toEqual({ success: true, data: patch });
    expect(connection.db.select().from(settings).all()).toHaveLength(6);
    expect(connection.sqlite.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get('asr.language'))
      .toEqual({ value: 'null', updated_at: now() });
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
