import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations, transcriptions, type NewTranscription } from '../../src/main/db';
import {
  beginHistory, clearHistory, completeHistory, deleteHistory, failHistory, getHistory,
  listHistory, markHistoryInserted, markHistoryProcessing, pruneHistory, recoverHistory,
} from '../../src/main/services/history/procedures';
import { writeAudio } from '../../src/main/services/history/lib/audio-store';
import type { AudioDependencies, BeginDependencies, HistoryResult } from '../../src/main/services/history/types';
import { getDefaultSettings } from '../../src/main/services/settings/types';
import type { HistoryChange } from '../../src/shared/types/history';

function data<T>(result: HistoryResult<T>): T {
  expect(result.success).toBe(true);
  if (result.success === false) throw new Error(result.error);
  return result.data;
}

describe('history procedures', () => {
  let connection: ReturnType<typeof openDatabase>;
  let directory: string;
  let timestamp: number;
  let deps: AudioDependencies & BeginDependencies;
  let sequence: number;
  const onChanged = vi.fn<(change: HistoryChange) => void>();
  const completion = { rawText: 'raw words', finalText: 'final words', audioDurationMs: 1234.6, latencyMs: 45.4, detectedLanguage: 'en' };

  beforeEach(() => {
    connection = openDatabase(':memory:');
    runMigrations(connection.db, path.resolve(__dirname, '../../drizzle'));
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-history-'));
    timestamp = Date.UTC(2026, 9, 15, 12);
    sequence = 0;
    onChanged.mockClear();
    deps = { now: () => timestamp, settings: getDefaultSettings({}), onChanged, appVersion: '1.2.3', audioDir: path.join(directory, 'audio') };
  });

  afterEach(() => {
    try {
      connection?.sqlite.close();
    } finally {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function begin(): string {
    const id = beginHistory(connection.db, { engine: 'whisper.cpp', language: 'en', engineModel: 'base', meta: { private: 'metadata' } }, deps);
    expect(id).not.toBeNull();
    if (id === null) throw new Error('Failed to begin history');
    return id;
  }

  function row(id: string) {
    const value = connection.db.select().from(transcriptions).where(eq(transcriptions.id, id)).get();
    if (!value) throw new Error(`Missing row ${id}`);
    return value;
  }

  function seed(overrides: Partial<NewTranscription> = {}): string {
    const id = `01929f55-0000-7000-8000-${(++sequence).toString(16).padStart(12, '0')}`;
    connection.db.insert(transcriptions).values({
      id, createdAt: timestamp, updatedAt: timestamp, status: 'completed',
      engine: 'whisper.cpp', appVersion: deps.appVersion, finalText: 'saved words', ...overrides,
    }).run();
    return id;
  }

  it('begins a recording with a UUID v7 and the supplied metadata and clock', () => {
    const id = begin();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row(id)).toMatchObject({ id, status: 'recording', createdAt: timestamp, updatedAt: timestamp, appVersion: '1.2.3', mode: 'dictation', language: 'en', engine: 'whisper.cpp', engineModel: 'base', meta: { private: 'metadata' } });
    expect(onChanged).toHaveBeenCalledWith({ id, kind: 'created' });
  });

  it('marks an active recording as processing and updates its timestamp', () => {
    const id = begin();
    timestamp += 100;
    expect(markHistoryProcessing(connection.db, id, deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'processing', updatedAt: timestamp });
    expect(onChanged).toHaveBeenLastCalledWith({ id, kind: 'updated' });
  });

  it.each(['recording', 'processing'])('completes a %s row with text and rounded durations', async (status) => {
    const id = begin();
    if (status === 'processing') expect(markHistoryProcessing(connection.db, id, deps)).toBe(true);
    timestamp += 200;
    expect(await completeHistory(connection.db, id, { ...completion, engineModel: 'medium' }, deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'completed', rawText: 'raw words', finalText: 'final words', audioDurationMs: 1235, latencyMs: 45, detectedLanguage: 'en', engineModel: 'medium', updatedAt: timestamp });
  });

  it('completes whitespace-only text as empty while retaining the original text', async () => {
    const id = begin();
    expect(await completeHistory(connection.db, id, { ...completion, finalText: ' \n\t ' }, deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'empty', finalText: ' \n\t ', audioDurationMs: 1235, latencyMs: 45 });
  });

  it.each(['recording', 'processing'])('fails a %s row with its error details', (status) => {
    const id = begin();
    if (status === 'processing') markHistoryProcessing(connection.db, id, deps);
    timestamp += 300;
    expect(failHistory(connection.db, id, 'asr_error', 'transcription failed', deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'failed', errorCode: 'asr_error', errorMessage: 'transcription failed', updatedAt: timestamp });
    expect(onChanged).toHaveBeenLastCalledWith({ id, kind: 'updated' });
  });

  it('records insertion failure and then clears its error after successful insertion', async () => {
    const id = begin();
    await completeHistory(connection.db, id, completion, deps);
    timestamp += 10;
    expect(markHistoryInserted(connection.db, id, 'failed', 'permission denied', deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'completed', insertStatus: 'failed', errorMessage: 'permission denied', updatedAt: timestamp });
    timestamp += 10;
    expect(markHistoryInserted(connection.db, id, 'inserted', undefined, deps)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'completed', insertStatus: 'inserted', errorMessage: null, updatedAt: timestamp });
  });

  it.each(['completed', 'empty', 'failed'] as const)('rejects further lifecycle transitions from terminal state %s without changes or events', async (status) => {
    const id = seed({ status });
    const before = row(id);
    timestamp += 1000;
    expect(failHistory(connection.db, id, 'late_error', 'late failure', deps)).toBe(false);
    expect(await completeHistory(connection.db, id, completion, deps)).toBe(false);
    expect(markHistoryProcessing(connection.db, id, deps)).toBe(false);
    expect(row(id)).toEqual(before);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('makes recording writes no-ops when history is disabled', async () => {
    const id = begin();
    const before = row(id);
    onChanged.mockClear();
    deps.settings.history.enabled = false;
    timestamp += 1000;
    expect(beginHistory(connection.db, { engine: 'whisper.cpp' }, deps)).toBeNull();
    expect(await completeHistory(connection.db, id, completion, deps)).toBe(false);
    expect(failHistory(connection.db, id, 'disabled', 'ignored', deps)).toBe(false);
    expect(markHistoryProcessing(connection.db, id, deps)).toBe(false);
    expect(markHistoryInserted(connection.db, id, 'inserted', undefined, deps)).toBe(false);
    expect(connection.db.select().from(transcriptions).all()).toEqual([before]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([true, false])('recovers only recording and processing rows when history.enabled is %s', (enabled) => {
    const recording = seed({ status: 'recording' });
    const processing = seed({ status: 'processing' });
    const terminals = (['completed', 'empty', 'failed'] as const).map((status) => row(seed({ status })));
    deps.settings.history.enabled = enabled;
    timestamp += 100;
    expect(recoverHistory(connection.db, deps)).toBe(2);
    for (const id of [recording, processing]) {
      expect(row(id)).toMatchObject({ status: 'failed', errorCode: 'interrupted', updatedAt: timestamp });
      expect(onChanged).toHaveBeenCalledWith({ id, kind: 'updated' });
    }
    for (const terminal of terminals) expect(row(terminal.id)).toEqual(terminal);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(recoverHistory(connection.db, deps)).toBe(0);
  });

  it.each([true, false])('prunes only rows older than retention and their audio when history.enabled is %s', async (enabled) => {
    const cutoff = timestamp - 7 * 86400000;
    const expired = seed({ createdAt: cutoff - 1 });
    const expiredWithoutAudio = seed({ createdAt: cutoff - 100 });
    const boundary = seed({ createdAt: cutoff });
    const recent = seed({ createdAt: cutoff + 1 });
    for (const id of [expired, boundary, recent]) {
      const audioPath = await writeAudio(deps.audioDir, id, row(id).createdAt, Buffer.from('audio'));
      connection.db.update(transcriptions).set({ audioPath }).where(eq(transcriptions.id, id)).run();
    }
    const expiredFile = path.join(deps.audioDir, row(expired).audioPath ?? 'missing');
    const retainedFiles = [boundary, recent].map((id) => path.join(deps.audioDir, row(id).audioPath ?? 'missing'));
    deps.settings.history.enabled = enabled;
    expect(await pruneHistory(connection.db, 7, deps)).toBe(2);
    expect(data(getHistory(connection.db, expired))).toBeNull();
    expect(data(getHistory(connection.db, expiredWithoutAudio))).toBeNull();
    expect(fs.existsSync(expiredFile)).toBe(false);
    for (const filename of retainedFiles) expect(fs.readFileSync(filename)).toEqual(Buffer.from('audio'));
    expect(data(listHistory(connection.db, {})).items.map((item) => item.id)).toEqual([recent, boundary]);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledWith({ id: expired, kind: 'deleted' });
    expect(onChanged).toHaveBeenCalledWith({ id: expiredWithoutAudio, kind: 'deleted' });
  });

  it('returns zero for null retention without deleting old rows or audio', async () => {
    const id = seed({ createdAt: timestamp - 365 * 86400000 });
    const audioPath = await writeAudio(deps.audioDir, id, row(id).createdAt, Buffer.from('old audio'));
    connection.db.update(transcriptions).set({ audioPath }).where(eq(transcriptions.id, id)).run();
    const before = row(id);
    deps.settings.history.enabled = false;
    expect(await pruneHistory(connection.db, null, deps)).toBe(0);
    expect(row(id)).toEqual(before);
    expect(fs.readFileSync(path.join(deps.audioDir, audioPath))).toEqual(Buffer.from('old audio'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('paginates shared timestamps in stable descending timestamp and ID order without gaps or duplicates', () => {
    const rows = Array.from({ length: 73 }, (_, index) => {
      const createdAt = timestamp + Math.floor(index / 25);
      return { id: seed({ createdAt }), createdAt };
    });
    const expected = rows.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).map((item) => item.id);
    const collected: string[] = [];
    let cursor: string | undefined;
    let finished = false;
    for (let page = 0; page < 20; page++) {
      const input = { limit: 7, ...(cursor === undefined ? {} : { cursor }) };
      const result = data(listHistory(connection.db, input));
      expect(data(listHistory(connection.db, input))).toEqual(result);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toBeLessThanOrEqual(7);
      collected.push(...result.items.map((item) => item.id));
      if (result.nextCursor === null) { finished = true; break; }
      cursor = result.nextCursor;
    }
    expect(finished).toBe(true);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(rows.length);
  });

  it('honors limits 1 and 200 and defaults to 50', () => {
    for (let index = 0; index < 205; index++) seed();
    for (const limit of [1, 200]) {
      const page = data(listHistory(connection.db, { limit }));
      expect(page.items).toHaveLength(limit);
      expect(page.nextCursor).not.toBeNull();
    }
    expect(data(listHistory(connection.db, {})).items).toHaveLength(50);
  });

  it.each([0, -1, 201, 1.5, '10'])('rejects out-of-bounds or invalid limit %j', (limit) => {
    expect(listHistory(connection.db, { limit }).success).toBe(false);
  });

  it('treats a blank query as no search so rows without text are still listed', () => {
    // Regression: the UI always sends query '', and LIKE '%%' never matches a NULL final_text
    const failed = seed({ status: 'failed', finalText: null, rawText: null, errorCode: 'start_failed' });
    const completed = seed();
    for (const query of ['', '   ']) {
      const ids = data(listHistory(connection.db, { query })).items.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([failed, completed]));
    }
    expect(data(listHistory(connection.db, { query: 'saved' })).items.map((item) => item.id)).toEqual([completed]);
  });

  it('filters rows by status', () => {
    const failed = seed({ status: 'failed' });
    seed({ status: 'completed' });
    seed({ status: 'recording' });
    expect(data(listHistory(connection.db, { status: 'failed' })).items.map((item) => item.id)).toEqual([failed]);
  });

  it.each([
    { query: '%', matching: 'rate 50% done', decoy: 'rate 50 done' },
    { query: '_', matching: 'snake_case', decoy: 'snakeXcase' },
    { query: '\\', matching: 'folder\\file', decoy: 'folderfile' },
    { query: '%_\\', matching: 'prefix%_\\suffix', decoy: 'prefixABC suffix' },
  ])('searches for literal $query rather than LIKE metacharacters', ({ query, matching, decoy }) => {
    const id = seed({ finalText: matching });
    seed({ finalText: decoy });
    seed({ finalText: 'unrelated', rawText: matching });
    expect(data(listHistory(connection.db, { query })).items.map((item) => item.id)).toEqual([id]);
  });

  it.each([
    'not-a-cursor', '!!!', '',
    Buffer.from(JSON.stringify({ createdAt: -1, id: '01929f55-0000-7000-8000-000000000001' })).toString('base64url'),
    Buffer.from(JSON.stringify({ createdAt: 1, id: 'invalid' })).toString('base64url'),
  ])('rejects invalid cursor %j', (cursor) => {
    seed();
    expect(listHistory(connection.db, { cursor })).toMatchObject({ success: false });
  });

  it('gets rows by string or object ID and returns null for a missing row', () => {
    const id = seed();
    expect(data(getHistory(connection.db, id))).toMatchObject({ id, finalText: 'saved words' });
    expect(getHistory(connection.db, { id })).toEqual(getHistory(connection.db, id));
    expect(data(getHistory(connection.db, '01929f55-0000-7000-8000-ffffffffffff'))).toBeNull();
  });

  it('keeps audio paths and metadata out of both renderer DTOs and exposes hasAudio', async () => {
    deps.settings.history.saveAudio = true;
    const withAudio = begin();
    const withoutAudio = seed({ meta: { secret: true } });
    expect(await completeHistory(connection.db, withAudio, { ...completion, wav: Buffer.from('audio') }, deps)).toBe(true);
    const storedPath = row(withAudio).audioPath;
    expect(storedPath).not.toBeNull();
    if (storedPath === null) throw new Error('Missing saved audio');
    expect(fs.readFileSync(path.join(deps.audioDir, storedPath))).toEqual(Buffer.from('audio'));
    for (const item of [data(getHistory(connection.db, withAudio)), data(getHistory(connection.db, withoutAudio)), ...data(listHistory(connection.db, {})).items]) {
      expect(item).not.toBeNull();
      expect(item).not.toHaveProperty('audioPath');
      expect(item).not.toHaveProperty('meta');
      expect(item?.hasAudio).toBe(item?.id === withAudio);
    }
  });

  it('deletes one row and its audio without affecting another row and handles repeated deletion', async () => {
    const id = seed();
    const other = seed();
    const audioPath = await writeAudio(deps.audioDir, id, timestamp, Buffer.from('audio'));
    connection.db.update(transcriptions).set({ audioPath }).where(eq(transcriptions.id, id)).run();
    expect(await deleteHistory(connection.db, { id }, deps)).toEqual({ success: true, data: { deleted: true } });
    expect(data(getHistory(connection.db, id))).toBeNull();
    expect(fs.existsSync(path.join(deps.audioDir, audioPath))).toBe(false);
    expect(data(getHistory(connection.db, other))).toMatchObject({ id: other });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ id, kind: 'deleted' });
    expect(await deleteHistory(connection.db, id, deps)).toEqual({ success: true, data: { deleted: false } });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('clears rows and all WAV files including orphans while retaining non-WAV files', async () => {
    const id = seed();
    seed();
    const audioPath = await writeAudio(deps.audioDir, id, timestamp, Buffer.from('audio'));
    connection.db.update(transcriptions).set({ audioPath }).where(eq(transcriptions.id, id)).run();
    fs.writeFileSync(path.join(deps.audioDir, 'orphan.wav'), 'orphan');
    fs.writeFileSync(path.join(deps.audioDir, 'keep.txt'), 'keep');
    expect(await clearHistory(connection.db, {}, deps)).toEqual({ success: true, data: { deleted: 2 } });
    expect(data(listHistory(connection.db, {}))).toEqual({ items: [], nextCursor: null });
    expect(fs.existsSync(path.join(deps.audioDir, audioPath))).toBe(false);
    expect(fs.existsSync(path.join(deps.audioDir, 'orphan.wav'))).toBe(false);
    expect(fs.readFileSync(path.join(deps.audioDir, 'keep.txt'), 'utf8')).toBe('keep');
    expect(onChanged).toHaveBeenCalledWith({ id: null, kind: 'cleared' });
    expect(await clearHistory(connection.db, {}, deps)).toEqual({ success: true, data: { deleted: 0 } });
  });

  it('notifies listeners of created, updated, deleted and cleared changes in order', async () => {
    const id = begin();
    markHistoryProcessing(connection.db, id, deps);
    await completeHistory(connection.db, id, completion, deps);
    markHistoryInserted(connection.db, id, 'inserted', undefined, deps);
    await deleteHistory(connection.db, id, deps);
    await clearHistory(connection.db, {}, deps);
    expect(onChanged.mock.calls.map(([change]) => change)).toEqual([
      { id, kind: 'created' }, { id, kind: 'updated' }, { id, kind: 'updated' },
      { id, kind: 'updated' }, { id, kind: 'deleted' }, { id: null, kind: 'cleared' },
    ]);
  });
});
