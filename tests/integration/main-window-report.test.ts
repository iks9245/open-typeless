/** Speech report through the real renderer, preload, IPC, Drizzle and optional oMLX. */
import path from 'node:path';
import { nativeTheme } from 'electron';
import { assert, run, startFakeOmlx, test, writeOmlxSettings } from './harness';
import { openMainWindow } from './ui';
import type { SpeechReport } from '../../src/shared/types/report';
import type { IpcResult } from '../../src/shared/types/common';

run(async () => {
  const { initDatabase, getDb, transcriptions } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initializes');
  const { setupAllIpcHandlers } = await import('../../src/main/ipc');
  const { settingsService } = await import('../../src/main/services/settings');
  const { historyService } = await import('../../src/main/services/history');
  setupAllIpcHandlers();
  const now = Date.now();
  const day = 86400000;
  let sequence = 0;
  const seed = (extra: Partial<typeof transcriptions.$inferInsert> = {}) => ({
    id: `report-private-${++sequence}`, createdAt: now - 1000, updatedAt: now - 1000,
    status: 'completed' as const, engine: 'whisper.cpp' as const, appVersion: '1.0',
    rawText: '那個那個，我是說 Coffee 世界', finalText: 'Coffee 世界',
    audioDurationMs: 1000, latencyMs: 500, ...extra,
  });
  getDb().insert(transcriptions).values([
    seed(), seed(), seed({ mode: 'command', rawText: '那個不對', finalText: 'privatecommandword' }),
    seed({ createdAt: now - 8 * day }), seed({ createdAt: now - 20 * day }),
    seed({ createdAt: now - 40 * day }), seed({ status: 'failed' }),
  ]).run();
  const ui = await openMainWindow();
  nativeTheme.themeSource = 'light';

  await test('report shows the local headline, stat cards, filler bars, activity and words', async () => {
    await ui.click('tab-report');
    await ui.waitFor('report-headline');
    assert((await ui.text('report-headline')).includes('4 次『那個』'), 'filler headline from current dictations');
    assert((await ui.text('report-stat-dictations')).includes('2'), 'dictation count excludes command');
    assert((await ui.text('report-stat-characters')).includes('字數'), 'character card shown');
    assert((await ui.text('report-stat-speaking')).includes('3 秒'), 'speaking time includes command');
    assert((await ui.text('report-stat-saved')).includes('以每分鐘打 40 字估算'), 'typing assumption shown');
    assert((await ui.text('report-stat-speed')).includes('字／分鐘'), 'speed card shown');
    assert((await ui.text('report-fillers')).includes('AI 刪掉 4 次'), 'removal counts shown');
    assert((await ui.text('report-corrections')).includes('2 次'), 'self-corrections exclude commands');
    assert(await ui.exec<boolean>(`document.querySelectorAll('[data-testid="report-hours"] .report-chart-bar').length === 24`), '24 hour bars');
    assert(await ui.exec<boolean>(`document.querySelectorAll('[data-testid="report-weekdays"] .report-chart-bar').length === 7`), '7 weekday bars');
    assert((await ui.text('report-words')).includes('coffee'), 'segmented words shown');
    assert(!(await ui.text('report-words')).includes('privatecommandword'), 'command words excluded');
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="report-comment"]').disabled`), 'AI comment disabled without oMLX');
    await ui.screenshot('report-week-light');
  });

  await test('ranges switch and all-time removes the prior-period comparison', async () => {
    await ui.select('report-range', 'month');
    await ui.waitUntil('month report', `document.querySelector('[data-testid="report-headline"]')?.textContent.includes('這個月')`);
    assert((await ui.text('report-stat-dictations')).includes('4'), '30 day count');
    await ui.select('report-range', 'all');
    await ui.waitUntil('all-time report', `document.querySelector('[data-testid="report-headline"]')?.textContent.includes('總共')`);
    assert((await ui.text('report-stat-dictations')).includes('5'), 'all-time count');
    assert(await ui.exec<boolean>(`!document.querySelector('[data-testid="report-stat-dictations"] .report-change')`), 'no all-time comparison');
    await ui.select('report-range', 'week');
    await ui.waitUntil('week report', `document.querySelector('[data-testid="report-headline"]')?.textContent.includes('這週')`);
    const invalid = await ui.exec<IpcResult<SpeechReport>>(`window.api.report.get({ range: 'day' })`);
    assert(!invalid.success, 'invalid range rejected over IPC');
  });

  await test('history changes refresh an active report and disabled history still reports existing rows', async () => {
    const id = historyService.begin({ engine: 'whisper.cpp' });
    assert(id, 'new session created');
    await historyService.complete(id, { rawText: '那個更新', finalText: '更新', audioDurationMs: 1000, latencyMs: 100, detectedLanguage: null });
    await ui.waitUntil('report refreshed', `document.querySelector('[data-testid="report-headline"]')?.textContent.includes('5 次『那個』')`);
    settingsService.update({ history: { enabled: false } });
    await ui.waitFor('report-history-disabled');
    const result = await ui.exec<IpcResult<SpeechReport>>(`window.api.report.get({ range: 'week' })`);
    assert(result.success && result.data.dictations === 3, 'existing rows remain readable', result);
    await ui.click('tab-history');
    await ui.exec(`document.querySelector('[data-testid="history-disabled-notice"] button').click()`);
    await ui.waitUntil('settings focused by id after adding a tab', `document.querySelector('#tab-settings').getAttribute('aria-selected') === 'true'`);
    settingsService.update({ history: { enabled: true } });
    await ui.click('tab-report');
  });

  await test('keyboard tab navigation includes report and reaches settings with End', async () => {
    await ui.exec(`document.querySelector('#tab-history').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    await ui.waitUntil('arrow reaches report', `document.querySelector('#tab-report').getAttribute('aria-selected') === 'true'`);
    await ui.exec(`document.querySelector('#tab-report').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))`);
    await ui.waitUntil('End reaches settings', `document.querySelector('#tab-settings').getAttribute('aria-selected') === 'true'`);
    await ui.click('tab-report');
  });

  await test('AI comments use the command model and exclude transcript text and top words', async () => {
    const omlx = await startFakeOmlx();
    try {
      await writeOmlxSettings(omlx.port, 'report-key');
      await ui.waitUntil('oMLX available', `!document.querySelector('[data-testid="report-comment"]').disabled`, 10000);
      omlx.reply = '說得流暢，休息一下再開口。';
      await ui.click('report-comment');
      await ui.waitFor('report-comment-text');
      assert((await ui.text('report-comment-text')).includes('說得流暢'), 'comment displayed');
      const body = omlx.lastBody;
      assert(body?.max_tokens === 200 && body.model === 'Qwen3.8-27B-oQ4e-mtp', 'command model and token budget', body);
      assert(!/Coffee|coffee|世界|privatecommandword|report-private/.test(JSON.stringify(body?.messages)), 'prompt contains no texts or top words');
    } finally {
      await writeOmlxSettings(null, null);
      await omlx.close();
    }
  });

  await test('report charts render in dark mode without CSP violations', async () => {
    nativeTheme.themeSource = 'dark';
    await ui.waitUntil('dark mode applied', "matchMedia('(prefers-color-scheme: dark)').matches");
    await ui.screenshot('report-week-dark');
    await ui.exec('new Promise(resolve => setTimeout(resolve, 50))');
    assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
  });

  await test('clearing history refreshes to the empty report', async () => {
    const result = await historyService.clear();
    assert(result.success, 'history cleared');
    await ui.waitFor('report-empty');
    assert((await ui.text('report-headline')) === '這段期間還沒有聽寫紀錄。', 'empty headline');
    assert(await ui.exec<boolean>(`document.querySelector('[data-testid="report-comment"]').disabled`), 'empty report disables commentary');
    await ui.screenshot('report-empty-dark');
  });

  nativeTheme.themeSource = 'system';
  ui.window.destroy();
});
