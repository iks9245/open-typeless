import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations, transcriptions, type NewTranscription } from '../../src/main/db';
import { ReportService } from '../../src/main/services/report/report.service';
import { reportInputSchema, type ReportDependencies } from '../../src/main/services/report/types';
import { getDefaultSettings } from '../../src/main/services/settings/types';

const now = new Date(2026, 9, 15, 12).getTime();
const day = 86400000;
const completion = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));
let connection: ReturnType<typeof openDatabase>;
let deps: ReportDependencies;
let service: ReportService;
let sequence: number;

beforeEach(() => {
  connection = openDatabase(':memory:');
  runMigrations(connection.db, path.resolve(__dirname, '../../drizzle'));
  sequence = 0;
  deps = {
    getDb: () => connection.db, now: () => now,
    readFile: async () => JSON.stringify({ server: { port: 1234 }, auth: { api_key: 'private-key' } }),
    env: {}, homedir: () => '/unused', logger: { debug: vi.fn(), warn: vi.fn() },
    fetch: vi.fn(async () => completion('<think>reasoning</think>「我们說得很好。」')),
    timers: { setTimeout, clearTimeout },
    getSettings: () => ({ success: true, data: getDefaultSettings({}) }),
  };
  service = new ReportService(deps);
});
afterEach(() => { connection?.sqlite.close(); });

function seed(extra: Partial<NewTranscription> = {}) {
  connection.db.insert(transcriptions).values({
    id: `private-row-${++sequence}`, createdAt: now - 1000, updatedAt: now - 1000,
    status: 'completed', engine: 'whisper.cpp', appVersion: '1.0',
    rawText: '那個 privateblueprint', finalText: 'privateblueprint', ...extra,
  }).run();
}

function report(range: 'week' | 'month' | 'all') {
  const result = service.build({ range });
  if (result.success === false) throw new Error(result.error);
  return result.data;
}

describe('report service and validation', () => {
  it.each([undefined, null, {}, { range: 'day' }, { range: 7 }, { range: 'week', text: 'private' }])('rejects invalid IPC input %j', input => {
    expect(reportInputSchema.safeParse(input).success).toBe(false);
    expect(service.build(input)).toEqual({ success: false, error: 'Invalid report range' });
  });

  it('queries completed rows, bounds current and prior windows, and projects aggregates only', () => {
    seed();
    seed({ status: 'failed' });
    seed({ status: 'recording' });
    seed({ status: 'processing' });
    seed({ status: 'empty' });
    seed({ createdAt: now + day });
    seed({ createdAt: now - 8 * day });
    seed({ createdAt: now - 31 * day });
    seed({ createdAt: now - 61 * day });
    expect(report('week')).toMatchObject({ dictations: 1, previous: { dictations: 1 } });
    expect(report('month')).toMatchObject({ dictations: 2, previous: { dictations: 1 } });
    expect(report('all')).toMatchObject({ dictations: 4, previous: null });
    const value = report('week');
    const encoded = JSON.stringify(value);
    for (const key of ['private-row', 'rawText', 'finalText', 'createdAt', 'id']) expect(encoded).not.toContain(key);
    expect(value.words).toContainEqual({ word: 'privateblueprint', count: 1 });
  });

  it('reads existing rows when history is disabled and returns a safe storage error', () => {
    seed();
    const settings = getDefaultSettings({});
    settings.history.enabled = false;
    deps.getSettings = () => ({ success: true, data: settings });
    expect(report('week').dictations).toBe(1);
    deps.getDb = () => { throw new Error('private database path'); };
    expect(service.build({ range: 'all' })).toEqual({ success: false, error: 'Report storage is unavailable' });
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toContain('private database path');
  });
});

describe('private report commentary', () => {
  it('uses command.model, 200 non-thinking tokens, 30s timeout, and a safe prompt without OpenCC', async () => {
    seed();
    const settings = getDefaultSettings({});
    settings.command.model = 'configured-command';
    settings.polish.model = 'different-polish';
    deps.getSettings = () => ({ success: true, data: settings });
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    const clear = vi.spyOn(deps.timers, 'clearTimeout');
    expect(await service.comment({ range: 'week' })).toEqual({ text: '我们說得很好。' });
    expect(timer.mock.calls[0][1]).toBe(30000);
    expect(clear).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer private-key' }, redirect: 'error' });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'configured-command', max_tokens: 200,
      chat_template_kwargs: { enable_thinking: false }, stream: false });
    expect(JSON.stringify(body.messages)).not.toMatch(/privateblueprint|private-row|words|rawText|finalText/);
  });

  it('does not call oMLX for invalid input or unavailable settings', async () => {
    expect(await service.comment({ range: 'bad' })).toEqual({ error: 'Invalid report range' });
    deps.getSettings = () => ({ success: false, error: 'private settings' });
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'Settings are unavailable' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('filters unexpected settings errors too', async () => {
    deps.getSettings = () => { throw new Error('private settings'); };
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'oMLX request failed' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('filters arbitrary errors from the reply and logs', async () => {
    deps.fetch = async () => { throw new Error('privateblueprint private-key'); };
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'oMLX request failed' });
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toMatch(/privateblueprint|private-key/);
  });

  it.each([401, 500])('returns known HTTP %s errors', async status => {
    deps.fetch = async () => new Response('private server body', { status });
    expect(await service.comment({ range: 'week' })).toEqual({ error: `oMLX responded with HTTP ${status}` });
  });

  it.each(['', '  ', '<think>hidden</think>', '<think>unfinished'])('rejects empty output %j', async text => {
    deps.fetch = async () => completion(text);
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'Empty command output' });
  });

  it('handles missing config and malformed responses with known errors', async () => {
    deps.readFile = async () => { throw new Error('private filename'); };
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'oMLX not installed' });
    deps.readFile = async () => JSON.stringify({ server: { port: 1234 } });
    deps.fetch = async () => new Response('invalid');
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'Invalid oMLX JSON response' });
    deps.fetch = async () => new Response('{}');
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'Invalid oMLX completion response' });
  });

  it('aborts hung requests and releases the timer', async () => {
    let signal: AbortSignal | null | undefined;
    deps.fetch = async (_url, init) => { signal = init?.signal; return new Promise(() => undefined); };
    deps.timers.setTimeout = callback => setTimeout(callback, 5);
    const clear = vi.spyOn(deps.timers, 'clearTimeout');
    expect(await service.comment({ range: 'week' })).toEqual({ error: 'oMLX request timed out' });
    expect((signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
  });
});
