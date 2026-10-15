/**
 * Push-to-talk end to end in the Electron main process: keyboard events, ASR against a
 * fake whisper.cpp server, text insertion (stubbed) and history recording.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { count, eq, inArray } from 'drizzle-orm';
import { TMP_DIR, assert, run, silenceChunk, startFakeOmlx, startFakeWhisper, writeOmlxSettings, test, toneChunk, unusedUrl, until, wait } from './harness';

interface PushToTalkInternals {
  handleKeyDown(mode?: 'dictation' | 'command'): Promise<void>;
  handleKeyUp(): Promise<void>;
  isActive: boolean;
}

interface KeyboardInternals {
  config: { triggerKey: number; minRecordingMs: number };
  onKeyDown: ((mode: 'dictation' | 'command') => void) | null;
  onKeyUp: (() => void) | null;
  onCancel: ((durationMs: number) => void) | null;
  handleKeyDown(keycode: number, modifiers?: { shift?: boolean }): void;
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
  const { commandService } = await import('../../src/main/services/command');
  const { floatingWindow } = await import('../../src/main/windows');

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

  const activeRows = (): number =>
    getDb().select({ c: count() }).from(transcriptions)
      .where(inArray(transcriptions.status, ['recording', 'processing'])).get()?.c ?? 0;
  const session = async (audio: ArrayBuffer = toneChunk()): Promise<void> => {
    await ptt.handleKeyDown();
    asrService.processAudioChunk(audio);
    await ptt.handleKeyUp();
    await until('the session to settle', () => !ptt.isActive && activeRows() === 0);
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

  const withKeyboardCallbacks = async (action: () => Promise<void>): Promise<void> => {
    const callbacks = { down: keyboard.onKeyDown, up: keyboard.onKeyUp, cancel: keyboard.onCancel };
    keyboard.onKeyDown = mode => void ptt.handleKeyDown(mode);
    keyboard.onKeyUp = () => void ptt.handleKeyUp();
    keyboard.onCancel = ms => void (pushToTalkService as unknown as { handleCancel(ms: number): Promise<void> }).handleCancel(ms);
    try {
      await action();
    } finally {
      keyboard.handleKeyUp(keyboard.config.triggerKey);
      keyboard.onKeyDown = callbacks.down;
      keyboard.onKeyUp = callbacks.up;
      keyboard.onCancel = callbacks.cancel;
    }
  };

  await test('initialize applies the saved trigger and settings changes update the live keyboard', async () => {
    const { permissionsService } = await import('../../src/main/services/permissions');
    const original = settingsService.get();
    assert(original.success, 'settings readable');
    const register = keyboardService.register;
    const accessibility = permissionsService.getAccessibilityStatus;
    const microphone = permissionsService.requestMicrophonePermission;
    try {
      // Exercise initialize without starting a native hook or prompting for microphone access.
      keyboardService.register = () => true;
      permissionsService.getAccessibilityStatus = () => true;
      permissionsService.requestMicrophonePermission = async () => true;
      configure({ input: { triggerKey: 'right-command' } });
      pushToTalkService.initialize();
      assert(keyboard.config.triggerKey === 3676, 'saved trigger applied at startup', keyboard.config);
      configure({ input: { triggerKey: 'f13' } });
      assert(Number(keyboard.config.triggerKey) === 91, 'settings change applied live', keyboard.config);
      await withKeyboardCallbacks(async () => {
        const before = inserted.length;
        keyboard.handleKeyDown(3640);
        assert(!ptt.isActive, 'previous trigger ignored');
        keyboard.handleKeyUp(3640);
        keyboard.handleKeyDown(91);
        await until('new trigger to listen', () => asrService.currentStatus === 'listening');
        asrService.processAudioChunk(toneChunk());
        await wait(250);
        keyboard.handleKeyUp(91);
        await until('new trigger session to complete', () => inserted.length === before + 1 && !ptt.isActive && activeRows() === 0);
        assert(inserted.at(-1) === '你好世界', 'new trigger inserted transcript');
      });
      pushToTalkService.dispose();
      configure({ input: { triggerKey: 'f14' } });
      assert(Number(keyboard.config.triggerKey) === 91, 'dispose unsubscribed settings listener');
    } finally {
      pushToTalkService.dispose();
      keyboardService.register = register;
      permissionsService.getAccessibilityStatus = accessibility;
      permissionsService.requestMicrophonePermission = microphone;
      configure(original.data);
      const { TRIGGER_KEYS } = await import('../../src/shared/constants/keyboard');
      keyboardService.setTriggerKey((TRIGGER_KEYS.find(key => key.id === original.data.input.triggerKey) ?? TRIGGER_KEYS[0]).keycode);
    }
  });

  await test('another key cancels a held trigger without transcription, insertion or history', async () => {
    await withKeyboardCallbacks(async () => {
      const before = { inferences: whisper.inferences, inserted: inserted.length, rows: rowCount() };
      keyboard.handleKeyDown(keyboard.config.triggerKey);
      await until('interrupted session to listen', () => asrService.currentStatus === 'listening');
      asrService.processAudioChunk(toneChunk());
      await wait(250);
      keyboard.handleKeyDown(30);
      keyboard.handleKeyDown(keyboard.config.triggerKey);
      keyboard.handleKeyUp(30);
      keyboard.handleKeyUp(keyboard.config.triggerKey);
      await until('cancelled row to be removed', () => !ptt.isActive && rowCount() === before.rows);
      assert(whisper.inferences === before.inferences, 'no transcription');
      assert(inserted.length === before.inserted, 'no insertion');
      assert(rowCount() === before.rows, 'no history row');
    });
  });

  await test('recording notifications target the main role even with an earlier extra window', async () => {
    const { registerTrustedWindow } = await import('../../src/main/ipc/sender');
    const extra = new BrowserWindow({ show: false });
    let main: BrowserWindow | null = null;
    try {
      main = new BrowserWindow({ show: false });
      registerTrustedWindow(main.webContents, 'main');
      await main.loadURL('data:text/html,<body>recording role test</body>');
      const received: unknown[][] = [];
      const extraReceived: unknown[][] = [];
      const contents = main.webContents;
      const send = contents.send;
      const extraSend = extra.webContents.send;
      contents.send = (channel, ...args) => { received.push([channel, ...args]); };
      extra.webContents.send = (channel, ...args) => { extraReceived.push([channel, ...args]); };
      try {
        await session();
        assert(received.some(args => args[0] === 'asr:status' && args[1] === 'listening'), 'main role receives recording start', received);
        assert(received.some(args => args[0] === 'asr:status' && args[1] === 'processing'), 'main role receives recording stop', received);
        assert(!extraReceived.some(args => args[0] === 'asr:status' && args[1] === 'listening'), 'extra window does not receive recording start', extraReceived);
      } finally {
        contents.send = send;
        extra.webContents.send = extraSend;
      }
    } finally {
      main?.destroy();
      extra.destroy();
    }
  });

  await test('a dictation is transcribed, inserted and recorded as completed', async () => {
    await session();
    const row = latest();
    assert(inserted.at(-1) === '你好世界', 'text inserted', inserted);
    assert(row.status === 'completed' && row.finalText === '你好世界', 'row completed', row);
    assert(row.insertStatus === 'inserted', 'insert status recorded', row);
    assert(row.audioDurationMs === 1000 && typeof row.latencyMs === 'number', 'duration and latency recorded', row);
  });

  const omlx = await startFakeOmlx();
  await test('AI polish inserts polished text, preserves raw history and sends the configured model and key', async () => {
    await writeOmlxSettings(omlx.port, 'test-key');
    configure({ polish: { enabled: true, model: 'Qwen3.8-27B-oQ4e-mtp' } });
    const emitted: string[] = [];
    const displayed: string[] = [];
    const onStatus = (status: string) => { emitted.push(status); };
    const sendStatus = floatingWindow.sendStatus;
    floatingWindow.sendStatus = (status) => { displayed.push(status); sendStatus.call(floatingWindow, status); };
    asrService.on('status', onStatus);
    try {
      await session();
    } finally {
      asrService.off('status', onStatus);
      floatingWindow.sendStatus = sendStatus;
    }
    // The floating window stays at 'processing' until the polished text is shown
    const afterStop = displayed.slice(displayed.indexOf('processing'));
    assert(afterStop.indexOf('done') === afterStop.length - 1 && !afterStop.includes('idle'), 'floating window kept processing while polishing', displayed);
    assert(emitted.at(-1) === 'idle', 'ASR listeners still see the real status', emitted);
    const row = latest();
    assert(inserted.at(-1) === '你好，世界。', 'polished text inserted', inserted.at(-1));
    assert(row.rawText === '你好世界' && row.finalText === '你好，世界。', 'raw and polished history recorded', row);
    assert(omlx.lastAuthorization === 'Bearer test-key', 'API key sent');
    assert(omlx.lastBody?.model === 'Qwen3.8-27B-oQ4e-mtp', 'configured model used', omlx.lastBody?.model);
    assert((omlx.lastBody?.chat_template_kwargs as { enable_thinking?: boolean })?.enable_thinking === false, 'thinking disabled');
  });

  await test('oMLX failure falls back to the raw transcript', async () => {
    try {
      omlx.mode = 'error';
      await session();
      assert(inserted.at(-1) === '你好世界', 'raw text inserted', inserted.at(-1));
      assert(latest().rawText === '你好世界' && latest().finalText === '你好世界', 'raw history preserved', latest());
    } finally {
      configure({ polish: { enabled: false } });
      await writeOmlxSettings(null, null);
      omlx.mode = 'ok';
    }
  });
  const commandSession = async (audio: ArrayBuffer = toneChunk()): Promise<void> => {
    const callbacks = { down: keyboard.onKeyDown, up: keyboard.onKeyUp, cancel: keyboard.onCancel };
    keyboard.onKeyDown = mode => void ptt.handleKeyDown(mode);
    keyboard.onKeyUp = () => void ptt.handleKeyUp();
    keyboard.onCancel = ms => void (pushToTalkService as unknown as { handleCancel(ms: number): Promise<void> }).handleCancel(ms);
    try {
      keyboard.handleKeyDown(keyboard.config.triggerKey, { shift: true });
      await until('command session to listen', () => asrService.currentStatus === 'listening');
      asrService.processAudioChunk(audio);
      await wait(250);
      keyboard.handleKeyUp(keyboard.config.triggerKey);
      await until('command session to finish', () => !ptt.isActive && activeRows() === 0);
    } finally {
      keyboard.onKeyDown = callbacks.down;
      keyboard.onKeyUp = callbacks.up;
      keyboard.onCancel = callbacks.cancel;
    }
  };

  for (const selection of ['private selected text', null]) {
    await test(`command mode ${selection === null ? 'generates at the cursor' : 'rewrites the selection'} and records only instruction and output`, async () => {
      const original = settingsService.get();
      assert(original.success, 'settings readable');
      const capture = commandService.captureSelection;
      const sendStatus = floatingWindow.sendStatus;
      const sendMode = floatingWindow.sendMode;
      const statuses: string[] = [];
      const modes: string[] = [];
      try {
        await writeOmlxSettings(omlx.port, 'command-key');
        configure({ command: { enabled: true, model: 'command-test-model' }, polish: { enabled: true, model: 'different-polish-model' } });
        commandService.captureSelection = async () => selection;
        omlx.reply = selection === null ? 'Generated letter' : 'Edited selection';
        floatingWindow.sendStatus = status => { statuses.push(status); sendStatus.call(floatingWindow, status); };
        floatingWindow.sendMode = mode => { modes.push(mode); sendMode.call(floatingWindow, mode); };
        await commandSession();
        const row = latest();
        assert(inserted.at(-1) === omlx.reply, 'command output inserted', inserted.at(-1));
        assert(row.mode === 'command' && row.rawText === '你好世界' && row.finalText === omlx.reply, 'instruction and output recorded', row);
        assert(selection === null || !JSON.stringify(row).includes(selection), 'selection absent from history');
        assert(row.status === 'completed' && row.insertStatus === 'inserted', 'command completed', row);
        assert(omlx.lastBody?.model === 'command-test-model', 'separate command model used', omlx.lastBody?.model);
        const messages = omlx.lastBody?.messages as { role: string; content: string }[];
        assert(messages[1].content === '<instruction>你好世界</instruction>' + (selection === null ? '' : `\n<selection>${selection}</selection>`), 'command prompt sent');
        assert(modes.includes('command'), 'floating command mode sent', modes);
        const afterStop = statuses.slice(statuses.indexOf('processing'));
        assert(afterStop.at(-1) === 'done' && !afterStop.includes('idle'), 'floating remains processing until command completes', statuses);
      } finally {
        commandService.captureSelection = capture;
        floatingWindow.sendStatus = sendStatus;
        floatingWindow.sendMode = sendMode;
        configure(original.data);
        omlx.reply = '你好，世界。';
        await writeOmlxSettings(null, null);
      }
    });
  }

  for (const failure of ['omlx', 'capture', 'empty-output', 'missing-omlx'] as const) {
    await test(`command ${failure} failure inserts nothing and records command_failed`, async () => {
      const original = settingsService.get();
      assert(original.success, 'settings readable');
      const capture = commandService.captureSelection;
      const sendError = floatingWindow.sendError;
      const errors: string[] = [];
      const before = inserted.length;
      try {
        await writeOmlxSettings(failure === 'missing-omlx' ? null : omlx.port, 'command-key');
        configure({ command: { enabled: true } });
        commandService.captureSelection = async () => {
          if (failure === 'capture') throw new Error('private selected text');
          return 'private selected text';
        };
        if (failure === 'omlx') omlx.mode = 'error';
        if (failure === 'empty-output') omlx.reply = '<think>thinking</think>';
        floatingWindow.sendError = error => { errors.push(error); sendError.call(floatingWindow, error); };
        await commandSession();
        assert(inserted.length === before, 'nothing inserted');
        const row = latest();
        assert(row.mode === 'command' && row.status === 'failed' && row.errorCode === 'command_failed', 'command failure recorded', row);
        assert(!JSON.stringify(row).includes('private selected text'), 'selection absent from failed history');
        assert(errors.some(error => error.startsWith('指令失敗：')), 'command failure displayed', errors);
      } finally {
        commandService.captureSelection = capture;
        floatingWindow.sendError = sendError;
        configure(original.data);
        omlx.mode = 'ok';
        omlx.reply = '你好，世界。';
        await writeOmlxSettings(null, null);
      }
    });
  }

  await test('an empty command instruction inserts nothing and records empty', async () => {
    const original = settingsService.get();
    assert(original.success, 'settings readable');
    const capture = commandService.captureSelection;
    const before = { inserted: inserted.length, requests: omlx.requests };
    try {
      configure({ command: { enabled: true } });
      commandService.captureSelection = async () => { throw new Error('capture must not matter for silence'); };
      await commandSession(silenceChunk(2000));
      assert(inserted.length === before.inserted, 'nothing inserted');
      assert(latest().status === 'empty' && latest().mode === 'command', 'empty command recorded', latest());
      assert(omlx.requests === before.requests, 'no command request');
    } finally {
      commandService.captureSelection = capture;
      configure(original.data);
    }
  });

  await test('a short command press cancels without selection capture, insertion or history', async () => {
    const original = settingsService.get();
    assert(original.success, 'settings readable');
    const capture = commandService.captureSelection;
    const minimum = keyboard.config.minRecordingMs;
    const before = { rows: rowCount(), inserted: inserted.length, inferences: whisper.inferences };
    let captures = 0;
    try {
      configure({ command: { enabled: true } });
      keyboard.config.minRecordingMs = 5000;
      commandService.captureSelection = async () => { captures++; return 'private selection'; };
      await commandSession(toneChunk(50));
      assert(captures === 0 && inserted.length === before.inserted, 'no capture or insertion');
      assert(rowCount() === before.rows && whisper.inferences === before.inferences, 'no history or transcription');
    } finally {
      keyboard.config.minRecordingMs = minimum;
      commandService.captureSelection = capture;
      configure(original.data);
    }
  });

  await test('disabled command mode treats Shift + Right Option as dictation', async () => {
    const original = settingsService.get();
    assert(original.success, 'settings readable');
    const capture = commandService.captureSelection;
    let captures = 0;
    try {
      configure({ command: { enabled: false }, polish: { enabled: false } });
      commandService.captureSelection = async () => { captures++; return 'private selected text'; };
      await commandSession();
      assert(captures === 0, 'selection not captured');
      assert(inserted.at(-1) === '你好世界' && latest().mode === 'dictation', 'ordinary dictation inserted and recorded', latest());
    } finally {
      commandService.captureSelection = capture;
      configure(original.data);
    }
  });
  await omlx.close();

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
    // The WAV is written after the row completes
    await until('the audio to be saved', () => latest().hasAudio);
    const row = latest();
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
    const started = Date.now();
    await session(silenceChunk(2000));
    // The skipped session reports 'done' synchronously; it must not wait for the 10 s timeout
    assert(Date.now() - started < 3000, 'finished quickly', Date.now() - started);
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
    await until('the start failure to be recorded', () => latest().status === 'failed' && !ptt.isActive);
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
    // A short press must stay short however slow the machine is
    const minRecordingMs = keyboard.config.minRecordingMs;
    keyboard.config.minRecordingMs = 5000;

    keyboard.handleKeyDown(keyboard.config.triggerKey);
    await wait(50);
    asrService.processAudioChunk(toneChunk(50));
    keyboard.handleKeyUp(keyboard.config.triggerKey);
    await until('the cancelled session to end and its row to be removed', () => !ptt.isActive && rowCount() === before.rows);
    keyboard.config.minRecordingMs = minRecordingMs;

    assert(whisper.inferences === before.inferences, 'no inference request');
    assert(inserted.length === before.inserted, 'nothing inserted');
    assert(rowCount() === before.rows, 'no history row left', rowCount());
    assert(!ptt.isActive, 'session ended');
  });

  await test('a normal key press after a cancel works', async () => {
    keyboard.handleKeyDown(keyboard.config.triggerKey);
    // Audio sent before the session is listening would be dropped
    await until('the session to be listening', () => asrService.currentStatus === 'listening');
    asrService.processAudioChunk(toneChunk());
    await wait(300);
    keyboard.handleKeyUp(keyboard.config.triggerKey);
    await until('the dictation to complete', () => latest().status === 'completed' && !ptt.isActive);
  });

  await test('with history disabled dictation still works and no row is written', async () => {
    configure({ history: { enabled: false } });
    const before = { rows: rowCount(), inserted: inserted.length };
    await session();
    await until('the text to be inserted', () => inserted.length === before.inserted + 1);
    assert(rowCount() === before.rows, 'no new row', rowCount());
    configure({ history: { enabled: true } });
  });

  await test('the vocabulary is sent as a prompt and nothing is sent without it', async () => {
    await session();
    assert(whisper.lastPrompt === null, 'no prompt without vocabulary', whisper.lastPrompt);

    configure({ asr: { vocabulary: ['Open Typeless', 'Trellis', 'whisper.cpp'] } });
    await session();
    assert(whisper.lastPrompt === '這段話可能會提到 Open Typeless、Trellis 和 whisper.cpp。', 'prompt sent', whisper.lastPrompt);
    configure({ asr: { vocabulary: [] } });
  });

  await test('line breaks between whisper segments are not inserted', async () => {
    whisper.text = '這個功能是用\nTrellis 框架\n實作的';
    await session();
    whisper.text = '你好世界';
    assert(inserted.at(-1) === '這個功能是用 Trellis 框架實作的', 'segments joined', inserted.at(-1));
  });

  await test('the IPC stopASR procedure still returns the plain result', async () => {
    await startASR();
    asrService.processAudioChunk(toneChunk());
    const result = await stopASR();
    assert(result.success && result.result?.text === '你好世界', 'stopASR result', result);
  });

  await whisper.close();
});
