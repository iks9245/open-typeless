import { describe, expect, it } from 'vitest';
import { errorCodeLabel, errorMessage, formatDuration, formatHistoryTime, insertStatusLabel, serverModeLabel, serverStateLabel, statusLabel } from '../../src/renderer/src/modules/main-window/lib/format';

describe('history time formatting', () => {
  const now = new Date(2026, 9, 15, 12, 0);

  it('shows local hours and minutes for today, with zero padding', () => {
    expect(formatHistoryTime(new Date(2026, 9, 15, 8, 3).getTime(), now)).toBe('08:03');
  });

  it('shows month/day for a different calendar date even less than 24 hours ago', () => {
    expect(formatHistoryTime(new Date(2026, 9, 14, 23, 59).getTime(), now)).toBe('10/14 23:59');
  });

  it('does not treat the same month and day in a different year as today', () => {
    expect(formatHistoryTime(new Date(2025, 9, 15, 8, 3).getTime(), now)).toBe('10/15 08:03');
    expect(formatHistoryTime(new Date(2026, 0, 2, 0, 0).getTime(), now)).toBe('1/2 00:00');
  });

  it('handles an invalid timestamp', () => {
    expect(formatHistoryTime(NaN, now)).toBe('時間不明');
  });
});

describe('duration formatting', () => {
  it.each([
    [0, '0.0 秒'], [90, '0.1 秒'], [1250, '1.3 秒'], [61000, '61.0 秒'],
    [null, '—'], [-1, '—'], [NaN, '—'], [Infinity, '—'],
  ])('formats %s milliseconds as %s', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});

describe('Traditional Chinese history labels', () => {
  it.each([
    ['start_failed', '無法連線到 whisper 伺服器'],
    ['transcription_failed', '辨識失敗'],
    ['stop_failed', '結束錄音時出錯'],
    ['interrupted', 'app 在錄音中被結束'],
    ['future_error', '發生未知錯誤'], [null, '發生未知錯誤'],
  ])('labels error %s', (code, expected) => {
    expect(errorCodeLabel(code)).toBe(expected);
  });

  it('covers transient and terminal history states', () => {
    const statuses = ['recording', 'processing', 'completed', 'empty', 'failed'] as const;
    expect(statuses.map(statusLabel))
      .toEqual(['錄音中', '辨識中', '完成', '沒有文字', '失敗']);
  });

  it('distinguishes pending, skipped and failed insertion', () => {
    expect(insertStatusLabel(null)).toBeNull();
    expect(insertStatusLabel('inserted')).toBe('已插入');
    expect(insertStatusLabel('skipped')).toBe('未插入');
    expect(insertStatusLabel('failed')).toBe('插入失敗');
  });
});

describe('server labels and unexpected errors', () => {
  it('covers every mode and lifecycle state', () => {
    const modes = ['managed', 'adopted', 'external', 'unavailable', 'none'] as const;
    const states = ['idle', 'starting', 'ready', 'stopped', 'failed'] as const;
    expect(modes.map(serverModeLabel)).toEqual(['由 app 管理', '沿用先前的程序', '外部伺服器', '找不到 whisper', '尚未偵測']);
    expect(states.map(serverStateLabel)).toEqual(['尚未啟動', '啟動中', '就緒', '已停止', '失敗']);
  });

  it('keeps IPC/exception details and provides a fallback for unknown rejections', () => {
    expect(errorMessage('讀取失敗')).toBe('讀取失敗');
    expect(errorMessage(new Error('連線中斷'))).toBe('連線中斷');
    for (const value of [null, undefined, {}, '', new Error('')]) {
      expect(errorMessage(value)).toBe('發生未知錯誤，請再試一次。');
    }
  });
});
