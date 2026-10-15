import { describe, expect, it } from 'vitest';
import { countCorrections, countTerm, FILLER_TERMS, summarizeFillers } from '../../src/main/services/report/lib/fillers';
import { buildReport, reportWindow, totals } from '../../src/main/services/report/lib/metrics';
import { topWords } from '../../src/main/services/report/lib/words';
import { buildCommentMessages } from '../../src/main/services/report/lib/comment-prompt';
import type { ReportRow } from '../../src/main/services/report/types';

const now = new Date(2026, 9, 15, 12).getTime();
const day = 86400000;
const row = (extra: Partial<ReportRow> = {}): ReportRow => ({
  createdAt: now - 1000, mode: 'dictation', rawText: '', finalText: '', audioDurationMs: null, latencyMs: null, ...extra,
});

describe('speech fillers and corrections', () => {
  it('counts CJK substrings without overlaps', () => {
    expect(countTerm('那個那個，講那個', '那個')).toBe(3);
    expect(countTerm('哈哈哈', '哈哈')).toBe(1);
    expect(countTerm('即係嗰個呢個咁樣', '即係')).toBe(1);
  });

  it('counts standalone interjections and the explicit leading exception', () => {
    expect(countTerm('嗯那個，嗯。是嗯嗯聲 嗯 好', '嗯')).toBe(3);
    expect(countTerm('是啊，那個啊聲，啊！', '啊')).toBe(1);
    expect(countTerm('啊你好', '啊')).toBe(1);
    expect(countTerm('𠮷啊，呃，欸！', '啊')).toBe(0);
    expect(countTerm('𠮷啊，呃，欸！', '呃')).toBe(1);
    expect(countTerm('𠮷啊，呃，欸！', '欸')).toBe(1);
  });

  it('matches English whole words and phrases case-insensitively', () => {
    expect(countTerm('UM um umbrella album umm', 'um')).toBe(2);
    expect(countTerm('Like likely unlike LIKE', 'like')).toBe(2);
    expect(countTerm('You Know, you know? you knowledge', 'you know')).toBe(2);
  });

  it('clamps removal per polished row and excludes command instructions', () => {
    const report = summarizeFillers([
      row({ rawText: '那個那個那個', finalText: '那個' }),
      row({ rawText: '那個', finalText: '那個那個' }),
      row({ rawText: '那個', finalText: '那個' }),
      row({ mode: 'command', rawText: '那個那個', finalText: '' }),
    ]);
    expect(report).toEqual({ top: [{ term: '那個', spoken: 5, removed: 2 }], total: 5, removedTotal: 2 });
  });

  it('limits ranking to 8 while totals include all lexicon terms', () => {
    const report = summarizeFillers([row({ rawText: FILLER_TERMS.join('，') })]);
    expect(report.top).toHaveLength(8);
    expect(report.total).toBe(FILLER_TERMS.length);
    expect(report.removedTotal).toBe(FILLER_TERMS.length);
  });

  it('counts all self-correction markers in dictations only', () => {
    const text = '不對不對，我是說應該是講錯，唔係我意思係';
    expect(countCorrections([row({ rawText: text }), row({ mode: 'command', rawText: text })])).toBe(7);
  });
});

describe('speech totals, windows and activity', () => {
  it('counts Unicode code points without whitespace, includes command output, and estimates time saved', () => {
    expect(totals([
      row({ finalText: '你 好\n😀𠮷', audioDurationMs: 2000, latencyMs: 500 }),
      row({ mode: 'command', finalText: 'A B', audioDurationMs: 1000, latencyMs: 1000 }),
    ])).toEqual({ dictations: 1, commands: 1, characters: 6, speakingMs: 3000,
      charactersPerMinute: 120, typingMs: 9000, savedMs: 4500 });
  });

  it('handles missing durations, zero speaking time, and clamps negative savings', () => {
    expect(totals([row()])).toMatchObject({ charactersPerMinute: null, savedMs: 0, speakingMs: 0 });
    expect(totals([row({ finalText: '字', audioDurationMs: 60000, latencyMs: 100 })]))
      .toMatchObject({ savedMs: 0, charactersPerMinute: 1 });
  });

  it.each([['week', 7], ['month', 30]] as const)('uses disjoint %s windows with an injected clock', (range, days) => {
    const rows = [
      row({ createdAt: now - days * day * 2 - 1 }),
      row({ createdAt: now - days * day * 2, finalText: '前' }),
      row({ createdAt: now - days * day - 1, finalText: '期' }),
      row({ createdAt: now - days * day, finalText: '本期', audioDurationMs: 1000 }),
      row({ createdAt: now - 1, finalText: '字' }),
      row({ createdAt: now, finalText: '未來' }),
      row({ createdAt: now + 1 }),
    ];
    expect(reportWindow(range, now)).toEqual({ start: now - days * day, previousStart: now - days * day * 2, end: now });
    expect(buildReport(rows, range, now)).toMatchObject({ dictations: 2, characters: 3, savedMs: 3500,
      previous: { dictations: 2, characters: 2, savedMs: 3000 } });
    expect(buildReport(rows, 'all', now)).toMatchObject({ dictations: 5, previous: null });
  });

  it('uses local hours and Monday-first weekdays, with commands in weekday activity only', () => {
    const monday = new Date(2026, 9, 12, 6, 30).getTime();
    const sunday = new Date(2026, 9, 11, 23, 30).getTime();
    const report = buildReport([
      row({ createdAt: monday }), row({ createdAt: monday }), row({ createdAt: sunday }),
      row({ createdAt: monday, mode: 'command' }),
    ], 'all', now);
    expect(report.hours).toHaveLength(24);
    expect(report.hours[6]).toBe(2);
    expect(report.hours[23]).toBe(1);
    expect(report.hours.reduce((a, b) => a + b, 0)).toBe(3);
    expect(report.peakHour).toBe(6);
    expect(report.weekdays).toEqual([3, 0, 0, 0, 0, 0, 1]);
    expect(buildReport([], 'all', now).peakHour).toBeNull();
  });

  it('excludes command rows from every text statistic', () => {
    const report = buildReport([row({ mode: 'command', rawText: '那個不對 um', finalText: 'Coffee 世界' })], 'week', now);
    expect(report).toMatchObject({ commands: 1, dictations: 0, corrections: 0, words: [],
      fillers: { top: [], total: 0, removedTotal: 0 }, peakHour: null });
    expect(report.characters).toBeGreaterThan(0);
  });
});

describe('word segmentation, headlines and private prompt', () => {
  it('segments final text, drops stopwords/fillers, normalizes Latin and limits results', () => {
    const words = topWords([row({ rawText: 'private', finalText: '我們 其實 那個 the and LIKE You Know Coffee coffee 世界 世界 字 go 123 😀' })]);
    expect(words).toEqual(expect.arrayContaining([{ word: 'coffee', count: 2 }, { word: '世界', count: 2 }]));
    expect(words).toHaveLength(2);
    expect(topWords([row({ finalText: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima' })])).toHaveLength(10);
    expect(topWords([row({ finalText: null })])).toEqual([]);
  });

  it('chooses deterministic filler, fallback and empty headlines for every range', () => {
    const rows = [row({ rawText: '那個那個', finalText: '那個' })];
    expect(buildReport(rows, 'week', now).headline).toBe('你這週說了 2 次『那個』，AI 幫你刪掉了 1 次。');
    expect(buildReport(rows, 'month', now).headline).toContain('這個月');
    expect(buildReport(rows, 'all', now).headline).toContain('總共');
    expect(buildReport([row({ finalText: '字'.repeat(3210) })], 'week', now).headline).toBe('你這週聽寫了 3,210 字，大約省下 80 分鐘。');
    expect(buildReport([], 'week', now).headline).toBe('這段期間還沒有聽寫紀錄。');
  });

  it('only sends numbers, fixed filler terms and counts, never row texts, top words or headline', () => {
    const rawText = '機密專案 secretblueprint 那個不對';
    const finalText = 'secretblueprint';
    const report = buildReport([row({ rawText, finalText })], 'week', now);
    report.headline = 'private headline';
    const prompt = JSON.stringify(buildCommentMessages(report));
    for (const secret of [rawText, finalText, '機密專案', 'private headline', 'words', 'createdAt', 'id']) expect(prompt).not.toContain(secret);
    expect(JSON.parse(buildCommentMessages(report)[1].content)).toMatchObject({
      dictations: 1, corrections: 1, fillers: { top: [{ term: '那個', spoken: 1, removed: 1 }] },
    });
  });
});
