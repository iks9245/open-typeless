/**
 * Push-to-talk end to end in the Electron main process: keyboard events, ASR against a
 * fake whisper.cpp server, text insertion (stubbed) and history recording.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { TMP_DIR, assert, run, silenceChunk, startFakeWhisper, test, toneChunk, unusedUrl, wait } from './harness';

interface PushToTalkInternals {
  handleKeyDown(): Promise<void>;
  handleKeyUp(): Promise<void>;
  isActive: boolean;
}

interface KeyboardInternals {
  config: { triggerKey: number };
  onKeyDown: (() => void) | null;
  onKeyUp: (() => void) | null;
  onCancel: ((durationMs: number) => void) | null;
  handleKeyDown(keycode: number): void;
  handleKeyUp(keycode: number): void;
}

run(async () => {
  const { initDatabase, getDb, transcriptions } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initializes');

  const { settingsService } = await import('../../src/main/services/settings');
  const { historyService } = await import('../../src/main/services/history');
  const { asrService } = await import('../../src/main/services/asr');
  const { stopASR, startASR } = await import('../../src/main/services/asr/procedures');
  const { textInputService } = await import('../../src/main/services/text-input');
  const { keyboardService } = await import('../../src/main/services/keyboard');
  const { pushToTalkService } = await import('../../src/main/services/push-to-talk/push-to-talk.service');

  // asr.handler registers this listener in the app; without it EventEmitter throws on 'error'
  asrService.on('error', () => undefined);

  const inserted: string[] = [];
  (textInputService as unknown as { insert: (text: string) => { success: boolean } }).insert = (text) => {
    inserted.push(text);
    return { success: true };
  };

  const whisper = await startFakeWhisper('你好世界');
  const ptt = pushToTalkService as unknown as PushToTalkInternals;
  const keyboard = keyboardService as unknown as KeyboardInternals;

  const session = async (audio: ArrayBuffer = toneChunk()): Promise<void> => {
    await ptt.handleKeyDown();
    asrService.processAudioChunk(audio);
    await ptt.handleKeyUp();
    await wait(300);
  };
  const latest = () => {
    const result = historyService.list({ limit: 1 });
    assert(result.success, 'history list succeeds', result);
    return result.data.items[0];
  };
  const rowCount = (): number =>
    getDb().select({ c: count() }).from(transcriptions).get()?.c ?? 0;
  const configure = (patch: Parameters<typeof settingsService.update>[0]): void => {
    const result = settingsService.update(patch);
    assert(result.success, 'settings update succeeds', result);
  };

  configure({ asr: { whisperServerUrl: whisper.url } });

  await test('a dictation is transcribed, inserted and recorded as completed', async () => {
    await session();
    const row = latest();
    assert(inserted.at(-1) === '你好世界', 'text inserted', inserted);
    assert(row.status === 'completed' && row.finalText === '你好世界', 'row completed', row);
    assert(row.insertStatus === 'inserted', 'insert status recorded', row);
    assert(row.audioDurationMs === 1000 && typeof row.latencyMs === 'number', 'duration and latency recorded', row);
  });

  await test('with autoInsert off nothing is typed and the row says skipped', async () => {
    configure({ input: { autoInsert: false } });
    const before = inserted.length;
    await session();
    assert(inserted.length === before, 'nothing inserted');
    assert(latest().insertStatus === 'skipped', 'insert skipped', latest());
    configure({ input: { autoInsert: true } });
  });

  await test('saved audio is written privately and removed with its row', async () => {
    configure({ history: { saveAudio: true } });
    await session();
    const row = latest();
    assert(row.hasAudio, 'row has audio', row);
    const stored = getDb().select({ audioPath: transcriptions.audioPath }).from(transcriptions)
      .where(eq(transcriptions.id, row.id)).get();
    assert(stored?.audioPath, 'audio path stored', stored);
    const file = path.join(TMP_DIR, 'userData', 'audio', stored.audioPath);
    assert(existsSync(file), 'wav exists', file);
    const removed = await historyService.delete({ id: row.id });
    assert(removed.success && !existsSync(file), 'row and wav deleted', removed);
    configure({ history: { saveAudio: false } });
  });

  await test('a silent recording is not sent for transcription and nothing is inserted', async () => {
    const before = { inferences: whisper.inferences, inserted: inserted.length };
    await session(silenceChunk(2000));
    assert(whisper.inferences === before.inferences, 'no inference request', whisper.inferences);
    assert(inserted.length === before.inserted, 'nothing inserted');
    assert(latest().status === 'empty', 'row is empty', latest());
  });

  await test('an inference error is recorded as transcription_failed without the old 10 s wait', async () => {
    whisper.mode = 'error';
    const started = Date.now();
    await session();
    whisper.mode = 'ok';
    const row = latest();
    assert(row.status === 'failed' && row.errorCode === 'transcription_failed', 'row failed', row);
    assert(Date.now() - started < 3000, 'finished quickly', Date.now() - started);
  });

  await test('an unreachable server is recorded as start_failed', async () => {
    configure({ asr: { whisperServerUrl: await unusedUrl() } });
    await ptt.handleKeyDown();
    await wait(200);
    configure({ asr: { whisperServerUrl: whisper.url } });
    const row = latest();
    assert(row.status === 'failed' && row.errorCode === 'start_failed', 'row start_failed', row);
    assert(!ptt.isActive, 'push-to-talk reset');
  });

  await test('a short key press is cancelled: no transcription, no insertion, no row', async () => {
    keyboard.onKeyDown = () => void ptt.handleKeyDown();
    keyboard.onKeyUp = () => void ptt.handleKeyUp();
    keyboard.onCancel = (durationMs) => void (pushToTalkService as unknown as { handleCancel(ms: number): Promise<void> }).handleCancel(durationMs);
    const before = { inferences: whisper.inferences, inserted: inserted.length, rows: rowCount() };

    keyboard.handleKeyDown(keyboard.config.triggerKey);
    await wait(50);
    asrService.processAudioChunk(toneChunk(50));
    await wait(30);
    keyboard.handleKeyUp(keyboard.config.triggerKey);
    await wait(500);

    assert(whisper.inferences === before.inferences, 'no inference request');
    assert(inserted.length === before.inserted, 'nothing inserted');
    assert(rowCount() === before.rows, 'no history row left', rowCount());
    assert(!ptt.isActive, 'session ended');
  });

  await test('a normal key press after a cancel works', async () => {
    keyboard.handleKeyDown(keyboard.config.triggerKey);
    await wait(100);
    asrService.processAudioChunk(toneChunk());
    await wait(300);
    keyboard.handleKeyUp(keyboard.config.triggerKey);
    await wait(800);
    assert(latest().status === 'completed', 'row completed', latest());
  });

  await test('with history disabled dictation still works and no row is written', async () => {
    configure({ history: { enabled: false } });
    const before = { rows: rowCount(), inserted: inserted.length };
    await session();
    assert(rowCount() === before.rows, 'no new row', rowCount());
    assert(inserted.length === before.inserted + 1, 'text inserted');
    configure({ history: { enabled: true } });
  });

  await test('the IPC stopASR procedure still returns the plain result', async () => {
    await startASR();
    asrService.processAudioChunk(toneChunk());
    const result = await stopASR();
    assert(result.success && result.result?.text === '你好世界', 'stopASR result', result);
  });

  await whisper.close();
});
