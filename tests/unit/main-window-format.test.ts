import { getDefaultSettings } from '../../src/main/services/settings/types';
import { describe, expect, it } from 'vitest';
import { formatModelSize, modelLockReason, formatReportDuration, formatReportNumber, polishStyleModelHint, polishModelOptions, polishReasonLabel, errorCodeLabel, errorMessage, formatDuration, formatHistoryTime, insertStatusLabel, serverBinaryLabel, serverModeLabel, serverStateLabel, statusLabel } from '../../src/renderer/src/modules/main-window/lib/format';
import type { WhisperServerInfo } from '../../src/shared/types/whisper-server';

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
    ['command_failed', '指令執行失敗'],
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
  it.each(['env', 'bundled', 'whisper.cpp', 'homebrew', 'system', null] as const)('labels binary source %s next to its name', binarySource => {
    const status: WhisperServerInfo = {
      mode: 'managed', state: 'ready', binaryName: 'whisper-server', binarySource,
      modelName: null, vadModelName: null, modelId: null, modelFallback: false, modelLocked: null, reason: null,
    };
    expect(serverBinaryLabel(status)).toBe(binarySource === 'bundled' ? 'whisper-server（內建）' : 'whisper-server');
    expect(serverBinaryLabel({ ...status, binaryName: null })).toBeNull();
  });

  it('covers every mode and lifecycle state', () => {
    const modes = ['managed', 'adopted', 'external', 'unavailable', 'none'] as const;
    const states = ['idle', 'starting', 'ready', 'stopped', 'failed'] as const;
    expect(modes.map(serverModeLabel)).toEqual(['由 app 管理', '沿用先前的程序', '外部伺服器', '找不到 whisper', '尚未偵測']);
    expect(states.map(serverStateLabel)).toEqual(['尚未啟動', '正在載入模型…', '就緒', '已停止', '失敗']);
  });

  it('keeps IPC/exception details and provides a fallback for unknown rejections', () => {
    expect(errorMessage('讀取失敗')).toBe('讀取失敗');
    expect(errorMessage(new Error('連線中斷'))).toBe('連線中斷');
    for (const value of [null, undefined, {}, '', new Error('')]) {
      expect(errorMessage(value)).toBe('發生未知錯誤，請再試一次。');
    }
  });
});

describe('polish labels and model choices', () => {
  it('warns for Cantonese with a non-27B model and follows language and style overrides', () => {
    const settings = getDefaultSettings({});
    expect(polishStyleModelHint(settings)).toBeNull();
    settings.asr.language = 'yue';
    expect(polishStyleModelHint(settings)).toContain('Qwen3.8-27B');
    settings.polish.style = 'standard';
    expect(polishStyleModelHint(settings)).toBeNull();
    settings.asr.language = 'en';
    settings.polish.style = 'cantonese';
    expect(polishStyleModelHint(settings)).toContain('較常改錯');
    settings.polish.model = 'Qwen3.8-27B-oQ4e-mtp';
    expect(polishStyleModelHint(settings)).toBeNull();
  });

  it('explains each unavailability reason', () => {
    expect(polishReasonLabel('not-installed')).toBe('找不到 oMLX，請先安裝並啟動 oMLX。');
    expect(polishReasonLabel('unreachable')).toBe('oMLX 未啟動或無法連線。');
    expect(polishReasonLabel('unauthorized')).toBe('oMLX 拒絕連線，請檢查 API 金鑰設定。');
  });

  it('orders installed recommendations, other installed models and the missing saved model', () => {
    const models = ['Zebra', 'Qwen3.8-27B-oQ4e-mtp', 'Alpha', 'Qwen3.5-9B-4bit', 'Alpha'];
    expect(polishModelOptions(models, 'missing')).toEqual([
      { id: 'Qwen3.5-9B-4bit', label: 'Qwen3.5-9B-4bit · 快速（建議）' },
      { id: 'Qwen3.8-27B-oQ4e-mtp', label: 'Qwen3.8-27B-oQ4e-mtp · 高品質' },
      { id: 'Alpha', label: 'Alpha' }, { id: 'Zebra', label: 'Zebra' },
      { id: 'missing', label: 'missing（未安裝）' },
    ]);
    expect(models).toHaveLength(5);
  });

  it('lists the 27B model first for command mode without changing polish order', () => {
    const models = ['Qwen3.5-9B-4bit', 'Qwen3.8-27B-oQ4e-mtp'];
    expect(polishModelOptions(models, models[1], models[1]).map(option => option.id)).toEqual([...models].reverse());
    expect(polishModelOptions(models, models[0]).map(option => option.id)).toEqual(models);
    expect(polishModelOptions([models[0]], models[1], models[1]).map(option => option.id)).toEqual([...models].reverse());
  });

  it('keeps missing recommendations selectable and does not duplicate an installed current model', () => {
    expect(polishModelOptions([], 'Qwen3.5-9B-4bit')).toEqual([{ id: 'Qwen3.5-9B-4bit', label: 'Qwen3.5-9B-4bit（未安裝）' }]);
    expect(polishModelOptions(['Alpha'], 'Alpha')).toEqual([{ id: 'Alpha', label: 'Alpha' }]);
    expect(polishModelOptions([], '')).toEqual([]);
  });
});

describe('report formatting', () => {
  it.each([
    [0, '0 秒'], [999, '0 秒'], [59999, '59 秒'], [60000, '1 分鐘'], [3599999, '59 分鐘'],
    [3600000, '1 小時 0 分'], [7500000, '2 小時 5 分'], [null, '—'], [-1, '—'], [NaN, '—'], [Infinity, '—'],
  ])('formats report duration %s as %s', (value, expected) => {
    expect(formatReportDuration(value)).toBe(expected);
  });
  it('uses Traditional Chinese number grouping and rounds speed to whole numbers', () => {
    expect(formatReportNumber(12345)).toBe('12,345');
    expect(formatReportNumber(123.8)).toBe('124');
    expect(formatReportNumber(NaN)).toBe('—');
  });
});


describe('ASR model labels', () => {
  it('shows model sizes in MB and GB', () => {
    expect(formatModelSize(512 * 1024 ** 2)).toBe('512.0 MB');
    expect(formatModelSize(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  it('explains environment and external locks', () => {
    expect(modelLockReason('env')).toBe('已由 WHISPER_MODEL_PATH 指定');
    expect(modelLockReason('external')).toBe('伺服器不是由 app 啟動，無法切換模型');
    expect(modelLockReason(null)).toBeUndefined();
  });
});
