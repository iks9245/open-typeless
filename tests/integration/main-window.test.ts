/**
 * Main window UI against the real preload, IPC handlers and database.
 * Set INTEGRATION_SCREENSHOTS to a directory to save screenshots of each tab.
 */

import path from 'node:path';
import { BrowserWindow, clipboard, nativeTheme } from 'electron';
import { count } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { assert, run, test, until, wait } from './harness';
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

  await test('the main preload exposes only the main window API', async () => {
    const keys = await ui.exec<{ api: string[]; asr: string[] }>(`({
      api: Object.keys(window.api).sort(), asr: Object.keys(window.api.asr).sort()
    })`);
    assert(JSON.stringify(keys.api) === JSON.stringify(['asr', 'history', 'memory', 'polish', 'report', 'settings', 'system', 'whisperServer']),
      'main API has no floatingWindow key', keys);
    assert(JSON.stringify(keys.asr) === JSON.stringify(['onError', 'onResult', 'onStatus', 'sendAudio']),
      'ASR API has no start or stop keys', keys);
  });

  await test('the same local page in an unregistered window cannot invoke settings', async () => {
    const html = process.env.INTEGRATION_RENDERER_HTML;
    const preload = process.env.INTEGRATION_PRELOAD;
    assert(html && preload, 'renderer and preload built');
    const untrusted = new BrowserWindow({
      show: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try {
      await untrusted.loadFile(html);
      const result = await untrusted.webContents.executeJavaScript('window.api.settings.get()');
      assert(JSON.stringify(result) === JSON.stringify({ success: false, error: 'Untrusted sender' }),
        'unregistered sender rejected', result);
    } finally {
      untrusted.destroy();
    }
  });

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
    // Focus arrives asynchronously, and slower CI runners need more than one request
    ui.window.show();
    const focusDeadline = Date.now() + 5000;
    while (!(await ui.exec<boolean>('document.hasFocus()')) && Date.now() < focusDeadline) {
      ui.window.focus();
      ui.window.webContents.focus();
      await wait(100);
    }
    assert(await ui.exec<boolean>('document.hasFocus()'), 'main window document focused');
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

  await test('trigger choices save and update footer and command help labels', async () => {
    const previous = settings().input.triggerKey;
    const { TRIGGER_KEYS } = await import('../../src/shared/constants/keyboard');
    try {
      await ui.click('tab-settings');
      const options = await ui.exec<{ id: string; label: string }[]>(`[...document.querySelector('[data-testid="settings-trigger-key"]').options].map(option => ({ id: option.value, label: option.textContent }))`);
      assert(JSON.stringify(options) === JSON.stringify(TRIGGER_KEYS.map(({ id, label }) => ({ id, label }))), 'all trigger choices listed', options);
      await ui.select('settings-trigger-key', 'right-command');
      await until('trigger key to save', () => settings().input.triggerKey === 'right-command');
      await ui.waitUntil('footer follows selected key', `document.querySelector('.app-footer').textContent.includes('右 Command')`);
      await ui.waitUntil('command help follows selected key', `document.querySelector('[aria-labelledby="command-heading"]').textContent.includes('Shift + 右 Command')`);
    } finally {
      settingsService.update({ input: { triggerKey: previous } });
      await ui.waitUntil('trigger selection restored', `document.querySelector('[data-testid="settings-trigger-key"]').value === ${JSON.stringify(previous)}`);
    }
  });

  await test('login switch is disabled for an unpackaged app and explains why', async () => {
    await ui.click('tab-settings');
    await ui.waitUntil('unsupported login item note', `document.querySelector('[aria-labelledby="input-heading"]').textContent.includes('只有打包後的 app 支援。')`);
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="settings-launch-at-login"]').disabled`), 'login switch disabled');
    const result = await ui.exec<{ success: boolean; data: { supported: boolean } }>('window.api.system.getLoginItem()');
    assert(result.success && !result.data.supported, 'OS API reports unsupported', result);
    const invalid = await ui.exec<{ success: boolean }>(`window.api.system.setLoginItem('yes')`);
    assert(!invalid.success, 'non-boolean rejected');
  });

  await test('hide-on-close keeps a separate test window alive until quitting', async () => {
    const { hideOnClose } = await import('../../src/main/windows/main-window');
    const window = new BrowserWindow({ show: false });
    let quitting = false;
    try {
      hideOnClose(window, () => quitting);
      window.close();
      assert(!window.isDestroyed() && !window.isVisible(), 'closed window stays alive and hidden');
      quitting = true;
      window.close();
      await until('quitting window to close', () => window.isDestroyed());
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  });

  await test('the polish section shows the not-installed state and disables its switch', async () => {
    await ui.click('tab-settings');
    await ui.waitUntil('oMLX missing status', `document.querySelector('[data-testid="polish-status"]')?.textContent.includes('找不到 oMLX，請先安裝並啟動 oMLX。')`, 3000);
    assert(await ui.exec<boolean>(`document.querySelector('#polish-heading')?.textContent === 'AI 潤稿'`), 'polish section shown');
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="settings-polish-enabled"]').disabled`), 'polish switch disabled');
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="settings-polish-model"]').disabled`), 'model select disabled');
  });

  await test('polish style saves, preserves other polish settings and updates Cantonese guidance', async () => {
    const previous = settings();
    try {
      settingsService.update({ asr: { language: 'en' }, polish: { style: 'auto', model: 'Qwen3.5-9B-4bit' } });
      await ui.click('tab-settings');
      await ui.waitUntil('style select ready', `document.querySelector('[data-testid="settings-polish-style"]')?.value === 'auto' && !document.querySelector('[data-testid="settings-polish-style"]').disabled`);
      assert(await ui.count('polish-style-model-hint') === 0, 'auto with English has no model warning');
      await ui.select('settings-polish-style', 'cantonese');
      await until('Cantonese style saved', () => settings().polish.style === 'cantonese');
      await ui.waitFor('polish-style-model-hint');
      assert((await ui.text('polish-style-model-hint')).includes('Qwen3.8-27B'), 'non-27B model warning');
      assert(await ui.exec<boolean>(`document.querySelector('[aria-labelledby="polish-heading"]').textContent.includes('會把辨識結果還原成粵語口語，每句約多 2–3 秒。建議使用 Qwen3.8-27B，9B 較常改錯。')`), 'Cantonese help shown');
      assert(settings().polish.model === 'Qwen3.5-9B-4bit' && settings().polish.enabled === previous.polish.enabled, 'style update preserves model and enablement');
      await ui.waitUntil('style save finished', `!document.querySelector('[data-testid="settings-polish-style"]').disabled`);
      await ui.select('settings-polish-style', 'standard');
      await until('standard style saved', () => settings().polish.style === 'standard');
      await ui.waitFor('polish-style-model-hint', { count: 0 });
      settingsService.update({ asr: { language: 'yue' } });
      await ui.waitUntil('language broadcast received', `document.querySelector('[data-testid="settings-language"]').value === 'yue' && !document.querySelector('[data-testid="settings-polish-style"]').disabled`);
      assert(await ui.count('polish-style-model-hint') === 0, 'standard overrides Cantonese language');
      await ui.select('settings-polish-style', 'auto');
      await until('auto style saved', () => settings().polish.style === 'auto');
      await ui.waitFor('polish-style-model-hint');
      settingsService.update({ polish: { model: 'Qwen3.8-27B-oQ4e-mtp' } });
      await ui.waitFor('polish-style-model-hint', { count: 0 });
      assert(settings().polish.style === 'auto', 'model update preserves style');
    } finally {
      settingsService.update({ asr: previous.asr, polish: previous.polish });
    }
  });

  await test('polished history shows the badge and original transcription', async () => {
    const id = historyService.begin({ engine: 'whisper.cpp' });
    assert(id, 'session begun');
    await historyService.complete(id, { rawText: '你好世界', finalText: '你好，世界。', audioDurationMs: 1000, latencyMs: 600, detectedLanguage: null });
    await ui.click('tab-history');
    await ui.waitFor('history-polished', { count: 1, timeoutMs: 3000 });
    assert((await ui.text('history-raw')).includes('原始辨識'), 'original disclosure shown');
    await ui.exec(`document.querySelector('[data-testid="history-raw"] summary').click()`);
    assert((await ui.text('history-raw')).includes('你好世界'), 'raw text shown');
  });

  await test('command settings share oMLX availability and allow disabling the enabled mode', async () => {
    const previous = settings().command;
    try {
      await ui.click('tab-settings');
      await ui.waitFor('settings-command-enabled');
      assert(await ui.exec<boolean>(`document.querySelector('#command-heading')?.textContent === '指令模式'`), 'command section shown');
      assert(await ui.checked('settings-command-enabled'), 'command enabled by default');
      assert(!(await ui.exec<boolean>(`document.querySelector('[data-testid="settings-command-enabled"]').disabled`)), 'enabled command can be turned off without oMLX');
      assert(await ui.exec<boolean>(`document.querySelector('[data-testid="settings-command-model"]').value === 'Qwen3.8-27B-oQ4e-mtp'`), '27B command default shown');
      await ui.click('settings-command-enabled');
      await until('command disabled', () => !settings().command.enabled);
      await ui.waitUntil('unavailable command switch disabled', `document.querySelector('[data-testid="settings-command-enabled"]').disabled`, 3000);
    } finally {
      settingsService.update({ command: previous });
    }
  });

  await test('command history shows its output, badge and expandable spoken instruction', async () => {
    const id = historyService.begin({ engine: 'whisper.cpp', mode: 'command' });
    assert(id, 'command begun');
    await historyService.complete(id, { rawText: '翻譯成英文', finalText: 'Hello, world.', audioDurationMs: 1000, latencyMs: 700, detectedLanguage: null });
    await ui.click('tab-history');
    await ui.waitFor('history-command', { count: 1, timeoutMs: 3000 });
    assert((await ui.text('history-command')) === '指令', 'command badge shown');
    assert((await ui.text('history-instruction')).includes('口述指令'), 'instruction disclosure shown');
    await ui.exec(`document.querySelector('[data-testid="history-instruction"] summary').click()`);
    assert((await ui.text('history-instruction')).includes('翻譯成英文'), 'instruction shown');
    assert(await ui.exec<boolean>(`document.querySelector('[data-id="${id}"] [data-testid="history-text"]').textContent.includes('Hello, world.')`), 'command output shown');
    assert(await ui.exec<boolean>(`!document.querySelector('[data-id="${id}"] [data-testid="history-polished"]')`), 'command is not labeled polished');
  });

  await test('command failures appear in the failure filter with a Chinese reason', async () => {
    const id = historyService.begin({ engine: 'whisper.cpp', mode: 'command' });
    assert(id && historyService.fail(id, 'command_failed', 'oMLX request failed'), 'command failure accepted');
    await ui.selectLabel('history-status-filter', '失敗');
    await ui.waitUntil('command failure shown', `[...document.querySelectorAll('[data-testid="history-text"]')].some(el => el.textContent.includes('指令執行失敗'))`, 3000);
    await ui.selectLabel('history-status-filter', '全部');
  });

  await test('clearing history asks for confirmation, then shows the empty state', async () => {
    await ui.click('tab-history');
    await ui.click('history-clear');
    assert(rowCount() > 0, 'nothing cleared before confirming');
    await ui.click('history-clear-confirm');
    await ui.waitFor('history-empty', { timeoutMs: 3000 });
    assert(rowCount() === 0, 'database cleared', rowCount());
    const previous = settings().input.triggerKey;
    try {
      settingsService.update({ input: { triggerKey: 'f15' } });
      await ui.waitUntil('empty state follows the trigger', `document.querySelector('[data-testid="history-empty"]').textContent.includes('按住F15 鍵開始聽寫')`);
    } finally {
      settingsService.update({ input: { triggerKey: previous } });
    }
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

  await test('the exercised UI has no securitypolicyviolation events', async () => {
    // Let pending CSP events and console diagnostics reach the main process.
    await ui.exec('new Promise((resolve) => setTimeout(resolve, 50))');
    assert(ui.securityPolicyViolations.length === 0, 'zero CSP violations', ui.securityPolicyViolations);
  });

  ui.window.destroy();
});
