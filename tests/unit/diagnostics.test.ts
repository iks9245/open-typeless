import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations, transcriptions } from '../../src/main/db';
import { getDefaultSettings } from '../../src/main/services/settings/types';
import { DiagnosticsService, LOG_TAIL_BYTES, readLogTail, type DiagnosticsDependencies } from '../../src/main/services/diagnostics/diagnostics.service';
import { createRedactor, redactJson } from '../../src/main/services/diagnostics/redact';
import type { DiagnosticsSummary } from '../../src/shared/types/diagnostics';
import { formatVersionInfo } from '../../src/renderer/src/modules/main-window/lib/format';

const summary: DiagnosticsSummary = {
  app: { version: '1.2.3', electron: '40.1.0', chrome: '144', node: '24', packaged: false, whisperCpp: 'whisper.cpp v1.9.5 (stamp)' },
  system: { release: '25.0.0', version: '26.0', cpu: 'Apple M4', totalMemoryGb: 32, freeDiskGb: 123, locale: 'zh-TW' },
};
const privateContent = ['UNIQUE_RAW_內容', 'UNIQUE_FINAL_內容', 'UNIQUE_AUDIO.wav', 'UNIQUE_ROW_ID', 'UNIQUE_VOCAB_詞', 'UNIQUE_KEY_123'];
let directory: string;
let connection: ReturnType<typeof openDatabase>;
let deps: DiagnosticsDependencies;
let service: DiagnosticsService;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'diagnostics-test-'));
  connection = openDatabase(':memory:');
  runMigrations(connection.db, path.resolve('drizzle'));
  const settings = getDefaultSettings({});
  settings.asr.vocabulary = [privateContent[4]];
  deps = {
    summary: async () => structuredClone(summary), settings: () => settings, db: () => connection.db,
    whisperServer: () => ({ mode: 'external', state: 'ready', reason: null, binaryName: 'whisper-server', binarySource: 'bundled', modelName: 'ggml-base.bin', vadModelName: null, modelId: 'app/ggml-base.bin', modelFallback: false, modelLocked: 'external' }),
    permissions: () => ({ microphone: 'denied', accessibility: false }),
    polish: async () => ({ available: true, reason: null, models: ['one', 'two'] }),
    models: async () => [{ key: 'base', installed: true, partialBytes: 32, active: true } as Awaited<ReturnType<DiagnosticsDependencies['models']>>[number]],
    memory: () => ({ enabled: true, state: 'idle', indexed: 3, total: 5, reason: null }),
    secrets: async () => [privateContent[5]], home: () => '/Users/tester', username: () => 'tester',
    tempDirectory: () => directory, logFile: () => path.join(directory, 'main.log'),
  };
  service = new DiagnosticsService(deps);
});
afterEach(() => { connection?.sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

function seed(index = 0) {
  connection.db.insert(transcriptions).values({
    id: index === 0 ? privateContent[3] : `row-private-${index}`, createdAt: 1792080000000 + index, updatedAt: 1792080000000,
    status: index % 2 ? 'completed' : 'failed', mode: index % 2 ? 'dictation' : 'command', engine: 'whisper.cpp', appVersion: '1.2.3',
    rawText: privateContent[0], finalText: privateContent[1], audioPath: privateContent[2], meta: { private: 'UNIQUE_METADATA' },
    errorCode: index % 2 ? null : 'transcription_failed', insertStatus: index % 2 ? 'inserted' : null,
    errorMessage: index === 0 ? privateContent.join(' ') : 'x'.repeat(250), audioDurationMs: 1234, latencyMs: 123, engineModel: 'base',
  }).run();
}

describe('diagnostics collection', () => {
  it('projects 50 recent rows with full-history aggregates and no content, paths, metadata or IDs', async () => {
    for (let i = 0; i < 55; i++) seed(i);
    const report = await service.collect();
    const json = JSON.stringify(report);
    for (const forbidden of [...privateContent, 'UNIQUE_METADATA', 'rawText', 'finalText', 'audioPath', '"meta"', '"id"', 'row-private-']) expect(json).not.toContain(forbidden);
    expect(report.history.recent).toHaveLength(50);
    expect(report.history.recent[0]).toEqual({
      createdAt: new Date(1792080000054).toISOString(), status: 'failed', mode: 'command', audioDurationMs: 1234,
      latencyMs: 123, errorCode: 'transcription_failed', errorMessage: 'x'.repeat(200), insertStatus: null, engineModel: 'base',
    });
    expect(report.history.counts.status).toEqual([{ status: 'completed', count: 27 }, { status: 'failed', count: 28 }]);
    expect(report.history.counts.mode).toEqual([{ mode: 'command', count: 28 }, { mode: 'dictation', count: 27 }]);
    expect(report.history.counts.errorCode).toContainEqual({ errorCode: 'transcription_failed', count: 28 });
    expect(report.history.counts.insertStatus).toContainEqual({ insertStatus: 'inserted', count: 27 });
    expect(report.polish).toEqual({ available: true, reason: null, modelCount: 2 });
    expect(report.models).toEqual([{ key: 'base', installed: true, partial: true, active: true }]);
    expect(report.settings).toEqual({ ...deps.settings(), asr: { ...deps.settings().asr, vocabulary: { count: 1 } } });
  });

  it('redacts accidental private content from error messages before truncation', async () => {
    seed();
    const json = JSON.stringify(await service.collect());
    for (const value of privateContent) expect(json).not.toContain(value);
    expect(json).toContain('[redacted]');
  });

  it('redacts private errors containing home paths before changing those paths', async () => {
    seed();
    const original = '/Users/tester/UNIQUE_RAW_內容';
    deps.settings().asr.vocabulary.push(original);
    deps.memory = () => ({ enabled: true, state: 'paused', indexed: 0, total: 1, reason: original });
    expect((await service.collect()).memory.reason).toBe('[redacted]');
  });

  it('preserves every technical setting when vocabulary or transcript words overlap settings values', async () => {
    const settings = deps.settings();
    settings.asr.vocabulary = ['auto', settings.polish.model, 'en'];
    settings.asr.language = 'en';
    seed();
    connection.db.insert(transcriptions).values({ id: 'overlap-row', createdAt: 1, updatedAt: 1, status: 'completed', engine: 'whisper.cpp', appVersion: '1', rawText: 'auto', finalText: 'auto' }).run();
    const report = await service.collect();
    expect(report.settings).toEqual({ ...settings, asr: { ...settings.asr, vocabulary: { count: 3 } } });
  });

  it('handles unavailable history, an absent version stamp and free-disk measurement', async () => {
    deps.db = () => null;
    deps.summary = async () => ({ ...summary, app: { ...summary.app, whisperCpp: null }, system: { ...summary.system, freeDiskGb: null } });
    const report = await service.collect();
    expect(report.history.recent).toEqual([]);
    expect(report.app.whisperCpp).toBeNull();
    expect(report.system.freeDiskGb).toBeNull();
  });

  it('formats a plain-text version block without HTML', () => {
    expect(formatVersionInfo(summary)).toBe('Open Typeless: 1.2.3\nwhisper.cpp: whisper.cpp v1.9.5 (stamp)\nElectron: 40.1.0\nmacOS: 26.0（Darwin 25.0.0）\n晶片: Apple M4\n記憶體: 32.0 GB');
  });
});

describe('redaction and archive', () => {
  it('ignores values too short to identify content, so phantom words do not shred logs', () => {
    const redact = createRedactor('/Users/tester', 'tester', ['you', '好', 'Thank you.', '我哋聽日食咗飯先']);
    expect(redact('Thank you. whisper-server ready, you are 好 我哋聽日食咗飯先再傾'))
      .toBe('[redacted] whisper-server ready, you are 好 [redacted]再傾');
  });

  it('redacts home paths and whole username path segments in JSON and logs', async () => {
    const text = '/Users/tester/config /Volumes/backup/tester/file /tmp/tester /tmp/tester-other/file C:\\Users\\tester\\file';
    const redact = createRedactor('/Users/tester', 'tester');
    expect(redact(text)).toBe('~/config /Volumes/backup/~/file /tmp/~ /tmp/tester-other/file C:\\Users\\~\\file');
    expect(redactJson({ nested: [text], untouched: 3 }, redact).nested[0]).toBe(redact(text));
    deps.memory = () => ({ enabled: true, state: 'paused', indexed: 0, total: 1, reason: text });
    expect(JSON.stringify(await service.collect())).not.toContain('/Users/tester');
  });

  it('redacts UUIDs and audio paths even after their history rows were deleted', () => {
    const redact = createRedactor('/Users/tester', 'tester');
    expect(redact('requestId: 01929f55-0000-7000-8000-000000000001 /tmp/old/audio.wav audio/deleted.webm'))
      .toBe('requestId: [redacted] [redacted] [redacted]');
  });

  it('reads only the last 2 MB, including a short file and missing logs', async () => {
    const file = deps.logFile();
    writeFileSync(file, `${'a'.repeat(LOG_TAIL_BYTES + 50)}END`);
    const tail = await readLogTail(file);
    expect(Buffer.byteLength(tail ?? '')).toBe(LOG_TAIL_BYTES);
    expect(tail?.endsWith('END')).toBe(true);
    writeFileSync(file, 'short');
    expect(await readLogTail(file)).toBe('short');
    expect(await readLogTail(path.join(directory, 'absent'))).toBeNull();
  });

  it('cleans the temporary directory after collection or zip failure', async () => {
    deps.zip = vi.fn().mockRejectedValue(new Error('zip failed'));
    await expect(service.export(path.join(directory, 'fail.zip'))).rejects.toThrow('zip failed');
    expect(readdirSync(directory)).toEqual([]);
    deps.settings = () => { throw new Error('settings failed'); };
    await expect(service.export(path.join(directory, 'fail.zip'))).rejects.toThrow('settings failed');
    expect(readdirSync(directory)).toEqual([]);
  });

  it.skipIf(process.platform !== 'darwin')('creates a real ditto archive with redacted JSON, README and bounded logs, then removes staging', async () => {
    seed();
    const sensitive = `/Users/tester/config /Volumes/backup/tester/file ${privateContent.join(' ')} Authorization: Bearer other-key api_key=another-key`;
    writeFileSync(deps.logFile(), `${'a'.repeat(LOG_TAIL_BYTES)}\n${sensitive}`);
    writeFileSync(path.join(directory, 'main.old.log'), sensitive);
    deps.memory = () => ({ enabled: true, state: 'paused', indexed: 0, total: 1, reason: '/Users/tester/config /Volumes/backup/tester/file' });
    const zip = path.join(directory, 'support.zip');
    expect(await service.export(zip)).toBe(zip);
    expect(existsSync(zip)).toBe(true);
    expect(readdirSync(directory).some(name => name.startsWith('open-typeless-diagnostics-'))).toBe(false);
    const extracted = path.join(directory, 'extracted');
    await promisify(execFile)('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
    // The archive's folder carries the zip name rather than the random staging name
    expect(readdirSync(extracted)).toEqual(['support']);
    const root = path.join(extracted, 'support');
    expect(readdirSync(root).sort()).toEqual(['README.txt', 'diagnostics.json', 'logs']);
    expect(readdirSync(path.join(root, 'logs')).sort()).toEqual(['main.log', 'main.old.log']);
    for (const file of ['diagnostics.json', 'logs/main.log', 'logs/main.old.log']) {
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const value of [...privateContent, '/Users/tester', '/backup/tester/', 'other-key', 'another-key']) expect(text).not.toContain(value);
      if (file.startsWith('logs')) expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LOG_TAIL_BYTES);
    }
    expect(JSON.parse(readFileSync(path.join(root, 'diagnostics.json'), 'utf8')).memory.reason).toBe('~/config /Volumes/backup/~/file');
    expect(readFileSync(path.join(root, 'README.txt'), 'utf8')).toContain('不包含');
  });
});
