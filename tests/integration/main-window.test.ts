/**
 * Main window UI against the real preload, IPC handlers and database.
 * Set INTEGRATION_SCREENSHOTS to a directory to save screenshots of each tab.
 */

import path from 'node:path';
import { clipboard, nativeTheme } from 'electron';
import { count } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { assert, run, test, until } from './harness';
import { openMainWindow } from './ui';

run(async () => {
  const { initDatabase, getDb, transcriptions } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initializes');
  const { setupAllIpcHandlers } = await import('../../src/main/ipc');
  const { settingsService } = await import('../../src/main/services/settings');
  const { historyService } = await import('../../src/main/services/history');
  const { planVocabularyPrompt } = await import('../../src/shared/lib/vocabulary-prompt');
  setupAllIpcHandlers();

  // 60 completed dictations, one of them about coffee, plus failures and an empty session
  const start = Date.now() - 60 * 60 * 1000;
  const row = (index: number, extra: Partial<typeof transcriptions.$inferInsert>) => ({
    id: randomUUID(),
    createdAt: start + index * 1000,
    updatedAt: start + index * 1000,
    status: 'completed' as const,
    engine: 'whisper.cpp' as const,
    appVersion: '1.0.0',
    audioDurationMs: 2300,
    latencyMs: 480,
    insertStatus: 'inserted' as const,
    ...extra,
  });
  getDb().insert(transcriptions).values([
    ...Array.from({ length: 60 }, (_, i) => row(i, {
      rawText: i === 7 ? '下午三點一起去喝咖啡吧' : `第 ${i + 1} 段聽寫內容`,
      finalText: i === 7 ? '下午三點一起去喝咖啡吧' : `第 ${i + 1} 段聽寫內容`,
    })),
    row(60, { status: 'failed', errorCode: 'start_failed', errorMessage: 'Cannot reach whisper.cpp server', insertStatus: null }),
    row(61, { status: 'failed', errorCode: 'interrupted', insertStatus: null }),
    row(62, { status: 'empty', rawText: '', finalText: '', insertStatus: null }),
  ]).run();
  const rowCount = (): number => getDb().select({ c: count() }).from(transcriptions).get()?.c ?? 0;
  const settings = () => {
    const result = settingsService.get();
    assert(result.success, 'settings readable', result);
    return result.data;
  };

  const ui = await openMainWindow();
  // Screenshots named *-light/*-dark must not depend on the system appearance
  nativeTheme.themeSource = 'light';

  await test('history shows 50 items first and loads the rest on request', async () => {
    await ui.waitFor('history-item', { count: 50 });
    await ui.screenshot('1-history-light');
    await ui.click('history-load-more');
    await ui.waitFor('history-item', { count: 63 });
  });

  await test('search finds dictations by their text', async () => {
    await ui.type('history-search', '咖啡');
    await ui.waitFor('history-item', { count: 1, timeoutMs: 3000 });
    assert((await ui.text('history-text')).includes('喝咖啡'), 'matching text shown', await ui.text('history-text'));
    await ui.type('history-search', '');
    await ui.waitFor('history-item', { count: 50, timeoutMs: 3000 });
  });

  await test('the failure filter explains each failure in Chinese', async () => {
    await ui.selectLabel('history-status-filter', '失敗');
    await ui.waitFor('history-item', { count: 2, timeoutMs: 3000 });
    const items = (await ui.texts('history-item')).join('\n');
    assert(items.includes('無法連線到 whisper 伺服器') && items.includes('app 在錄音中被結束'), 'failure reasons shown', items);
    await ui.selectLabel('history-status-filter', '全部');
    await ui.waitFor('history-item', { count: 50, timeoutMs: 3000 });
  });

  await test('copy is disabled without text and puts a dictation on the clipboard', async () => {
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="history-copy"]').disabled`), 'copy disabled for the empty session at the top');
    clipboard.clear();
    // navigator.clipboard needs a focused document, as when a user clicks the button
    ui.window.show();
    ui.window.focus();
    ui.window.webContents.focus();
    // Copy is disabled for sessions without text, so use the first item that has some
    const first = await ui.exec<string>(`(() => {
      const item = [...document.querySelectorAll('[data-testid="history-item"]')]
        .find((el) => !el.querySelector('[data-testid="history-copy"]').disabled);
      item.querySelector('[data-testid="history-copy"]').click();
      return item.querySelector('[data-testid="history-text"]').textContent.trim();
    })()`);
    await until('the clipboard to hold the text', () => clipboard.readText() === first, 3000).catch(() => undefined);
    assert(clipboard.readText() === first, 'clipboard matches', { clipboard: clipboard.readText(), first, status: await ui.text('save-status') });
    ui.window.hide();
  });

  await test('delete asks for confirmation before removing a dictation', async () => {
    const before = rowCount();
    await ui.click('history-delete');
    assert(rowCount() === before, 'nothing deleted before confirming');
    await ui.click('history-delete-confirm');
    await until('the row to be deleted', () => rowCount() === before - 1);
    assert(rowCount() === before - 1, 'one row deleted', { before, after: rowCount() });
  });

  await test('a new dictation appears without reloading the window', async () => {
    const id = historyService.begin({ engine: 'whisper.cpp' });
    assert(id, 'session begun');
    await historyService.complete(id, { rawText: '剛剛新增的聽寫', finalText: '剛剛新增的聽寫', audioDurationMs: 1000, latencyMs: 400, detectedLanguage: null, insert: { status: 'inserted' } });
    await ui.waitUntil('new dictation listed', `[...document.querySelectorAll('[data-testid="history-text"]')].some((el) => el.textContent.includes('剛剛新增的聽寫'))`, 3000);
  });

  await test('with history turned off the history tab says so', async () => {
    settingsService.update({ history: { enabled: false } });
    await ui.waitFor('history-disabled-notice', { timeoutMs: 3000 });
    settingsService.update({ history: { enabled: true } });
  });

  await test('vocabulary terms are validated, saved and previewed', async () => {
    await ui.click('tab-vocabulary');
    await ui.type('vocabulary-input', 'Open Typeless');
    await ui.pressEnter('vocabulary-input');
    await ui.waitFor('vocabulary-term', { count: 1, timeoutMs: 3000 });
    await ui.type('vocabulary-input', 'Trellis');
    await ui.click('vocabulary-add');
    await ui.waitFor('vocabulary-term', { count: 2, timeoutMs: 3000 });
    assert(JSON.stringify(settings().asr.vocabulary) === JSON.stringify(['Open Typeless', 'Trellis']), 'saved to settings', settings().asr.vocabulary);

    await ui.type('vocabulary-input', 'open typeless');
    await ui.click('vocabulary-add');
    await ui.waitFor('vocabulary-error', { timeoutMs: 2000 });
    assert(settings().asr.vocabulary.length === 2, 'duplicate not saved');

    await ui.type('vocabulary-input', 'X'.repeat(41));
    await ui.click('vocabulary-add');
    await ui.waitFor('vocabulary-error', { timeoutMs: 2000 });
    assert(settings().asr.vocabulary.length === 2, 'too-long term not saved');

    const expected = planVocabularyPrompt(['Open Typeless', 'Trellis']).prompt as string;
    assert((await ui.text('vocabulary-preview')).includes(expected), 'preview matches the sent prompt', await ui.text('vocabulary-preview'));
    assert((await ui.text('vocabulary-count')).includes('2 / 50'), 'count shown', await ui.text('vocabulary-count'));
    await ui.type('vocabulary-input', '');
    await ui.screenshot('2-vocabulary-light');

    await ui.exec(`document.querySelector('[data-term="Trellis"] [data-testid="vocabulary-remove"]').click()`);
    await ui.waitFor('vocabulary-term', { count: 1, timeoutMs: 3000 });
    assert(JSON.stringify(settings().asr.vocabulary) === JSON.stringify(['Open Typeless']), 'removal saved', settings().asr.vocabulary);
  });

  await test('settings changes are saved and invalid server URLs are rejected', async () => {
    await ui.click('tab-settings');
    await ui.waitFor('server-status');
    assert((await ui.text('server-status')).length > 0, 'server status shown');

    const autoInsert = await ui.checked('settings-auto-insert');
    await ui.click('settings-auto-insert');
    await until('autoInsert to be saved', () => settings().input.autoInsert === !autoInsert);

    // One change at a time: the panel rejects a second update while a save is in flight
    // (users cannot do this: controls are disabled while saving)
    await ui.selectLabel('settings-language', '粵語');
    await until('the language to be saved', () => settings().asr.language === 'yue');
    await ui.selectLabel('settings-retention', '30');
    await until('the retention to be saved', () => settings().history.retentionDays === 30);

    const url = settings().asr.whisperServerUrl;
    await ui.type('settings-server-url', 'ftp://example.com');
    await ui.blur('settings-server-url');
    await ui.waitUntil('URL error shown', `document.querySelector('#server-url-error')?.textContent.includes('http://')`, 2000);
    assert(settings().asr.whisperServerUrl === url, 'invalid URL not saved', settings().asr.whisperServerUrl);
    await ui.type('settings-server-url', 'http://127.0.0.1:9999');
    await ui.blur('settings-server-url');
    await until('the valid URL to be saved', () => settings().asr.whisperServerUrl === 'http://127.0.0.1:9999');

    settingsService.update({ input: { autoInsert } });
    await until('the toggle to follow settings.onChanged', async () => (await ui.checked('settings-auto-insert')) === autoInsert);
    await ui.screenshot('3-settings-light');
  });

  await test('clearing history asks for confirmation, then shows the empty state', async () => {
    await ui.click('tab-history');
    await ui.click('history-clear');
    assert(rowCount() > 0, 'nothing cleared before confirming');
    await ui.click('history-clear-confirm');
    await ui.waitFor('history-empty', { timeoutMs: 3000 });
    assert(rowCount() === 0, 'database cleared', rowCount());
    await ui.screenshot('4-history-empty-light');
  });

  await test('the recording hook still starts and stops the recorder', async () => {
    ui.console.length = 0;
    const log = (): string => ui.console.join('\n');
    ui.window.webContents.send('asr:status', 'listening');
    await until('the recorder to start', () => log().includes('Starting audio recording'));
    ui.window.webContents.send('asr:status', 'idle');
    await until('the recorder to stop', () => log().includes('Stopping audio recording') || log().includes('Failed to start recording'));
  });

  await test('dark mode renders', async () => {
    nativeTheme.themeSource = 'dark';
    await ui.waitUntil('dark mode to apply', "matchMedia('(prefers-color-scheme: dark)').matches");
    await ui.click('tab-vocabulary');
    await ui.screenshot('5-vocabulary-dark');
    await ui.click('tab-settings');
    await ui.screenshot('6-settings-dark');
    nativeTheme.themeSource = 'system';
  });

  ui.window.destroy();
});
