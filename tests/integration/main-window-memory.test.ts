/** Ask history through the real renderer, restricted preload, IPC, SQLite and fake local oMLX. */
import path from 'node:path';
import { assert, run, startFakeOmlx, test, until, writeOmlxSettings } from './harness';
import { openMainWindow } from './ui';

run(async () => {
  const { initDatabase, getDb, historyEmbeddings } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initializes');
  const { setupAllIpcHandlers } = await import('../../src/main/ipc');
  const { memoryIndexer } = await import('../../src/main/services/memory');
  const { historyService } = await import('../../src/main/services/history');
  setupAllIpcHandlers();
  const omlx = await startFakeOmlx();
  await writeOmlxSettings(omlx.port, 'memory-test');
  const id = historyService.begin({ engine: 'whisper.cpp' });
  assert(id, 'source created');
  await historyService.complete(id, { rawText: 'Ken 報價五萬元', finalText: 'Ken 報價五萬元', audioDurationMs: 1000, latencyMs: 100, detectedLanguage: null });
  memoryIndexer.start();
  await until('startup indexing', () => memoryIndexer.status().indexed === 1);
  const ui = await openMainWindow();
  try {
    await test('typed questions show answers, citation chips and sources, IME Enter does not send', async () => {
      omlx.reply = 'Ken 報價五萬元。[1]';
      await ui.click('tab-ask');
      await ui.waitUntil('ask enabled', `!document.querySelector('[data-testid="ask-input"]').disabled`);
      await ui.type('ask-input', 'Ken 的報價是多少？');
      await ui.exec(`document.querySelector('[data-testid="ask-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))`);
      assert(omlx.requests === 0, 'IME does not send a question');
      await ui.pressEnter('ask-input');
      await ui.waitFor('ask-answer');
      assert((await ui.text('ask-answer')).includes('五萬元'), 'answer displayed');
      assert((await ui.text('ask-sources')).includes('Ken 報價五萬元'), 'source snippet shown');
      await ui.exec(`document.querySelector('[data-testid="ask-answer"] button').click()`);
      assert(await ui.exec(`document.querySelector('[data-testid="ask-source-1"]').classList.contains('ask-source-highlight')`), 'citation highlights source');
      assert(await ui.exec(`document.activeElement === document.querySelector('[data-testid="ask-source-1"]')`), 'citation focuses source');
      await ui.screenshot('ask-answer');
    });
    await test('settings reports status, disabling deletes vectors and disables asking, enabling backfills', async () => {
      await ui.click('tab-settings');
      await ui.waitUntil('indexed status', `document.querySelector('[data-testid="memory-status"]').textContent.includes('1／1')`);
      await ui.click('settings-memory-enabled');
      await until('vectors cleared', () => getDb().select().from(historyEmbeddings).all().length === 0);
      await ui.click('tab-ask');
      await ui.waitFor('ask-disabled');
      assert(await ui.exec(`document.querySelector('[data-testid="ask-submit"]').disabled`), 'asking disabled');
      await ui.click('tab-settings');
      await ui.click('settings-memory-enabled');
      await until('vectors backfilled', () => memoryIndexer.status().indexed === 1);
      await ui.click('memory-reindex');
      await until('rebuilt vectors', () => memoryIndexer.status().indexed === 1);
      assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
    });
    await test('deleting history cascades embeddings through real history service', async () => {
      await historyService.delete({ id });
      assert(getDb().select().from(historyEmbeddings).all().length === 0, 'vectors removed by cascade');
      assert(memoryIndexer.chunks().length === 0, 'retrieval cache invalidated');
    });
  } finally {
    memoryIndexer.stop();
    ui.window.destroy();
    await writeOmlxSettings(null, null);
    await omlx.close();
  }
});
