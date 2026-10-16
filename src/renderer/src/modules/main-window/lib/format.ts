import { effectivePolishStyle } from '../../../../../shared/lib/polish-style';
import type { AppSettings } from '../../../../../shared/types/settings';
import type { PolishUnavailableReason } from '../../../../../shared/types/polish';
import { RECOMMENDED_POLISH_MODELS } from '../../../../../shared/constants/polish';
import type { InsertStatus, TranscriptionStatus } from '../../../../../shared/constants/history';
import type { WhisperServerInfo } from '../../../../../shared/types/whisper-server';

/** Use local calendar dates, including across daylight-saving transitions. */
export function formatHistoryTime(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '時間不明';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return today ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

export function statusLabel(status: TranscriptionStatus): string {
  return {
    recording: '錄音中', processing: '辨識中', completed: '完成', empty: '沒有文字', failed: '失敗',
  }[status];
}

/** Null when nothing was attempted (failed or empty sessions), so no label is shown */
export function insertStatusLabel(status: InsertStatus | null): string | null {
  if (status === null) return null;
  return { inserted: '已插入', failed: '插入失敗', skipped: '未插入' }[status];
}

export function errorCodeLabel(code: string | null): string {
  switch (code) {
    case 'start_failed': return '無法連線到 whisper 伺服器';
    case 'transcription_failed': return '辨識失敗';
    case 'command_failed': return '指令執行失敗';
    case 'stop_failed': return '結束錄音時出錯';
    case 'interrupted': return 'app 在錄音中被結束';
    default: return '發生未知錯誤';
  }
}

export function serverModeLabel(mode: WhisperServerInfo['mode']): string {
  return {
    managed: '由 app 管理', adopted: '沿用先前的程序', external: '外部伺服器', unavailable: '找不到 whisper', none: '尚未偵測',
  }[mode];
}

export function serverStateLabel(state: WhisperServerInfo['state']): string {
  return { idle: '尚未啟動', starting: '正在載入模型…', ready: '就緒', stopped: '已停止', failed: '失敗' }[state];
}

export function serverBinaryLabel(status: WhisperServerInfo): string | null {
  if (status.binaryName === null) return null;
  return status.binarySource === 'bundled' ? `${status.binaryName}（內建）` : status.binaryName;
}

export function formatModelSize(sizeBytes: number): string {
  return sizeBytes >= 1024 ** 3 ? `${(sizeBytes / 1024 ** 3).toFixed(1)} GB` : `${(sizeBytes / 1024 ** 2).toFixed(1)} MB`;
}

export function modelLockReason(lock: WhisperServerInfo['modelLocked']): string | undefined {
  if (lock === 'env') return '已由 WHISPER_MODEL_PATH 指定';
  if (lock === 'external') return '伺服器不是由 app 啟動，無法切換模型';
  return undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '發生未知錯誤，請再試一次。';
}

export function polishReasonLabel(reason: PolishUnavailableReason | null): string {
  switch (reason) {
    case 'not-installed': return '找不到 oMLX，請先安裝並啟動 oMLX。';
    case 'unauthorized': return 'oMLX 拒絕連線，請檢查 API 金鑰設定。';
    default: return 'oMLX 未啟動或無法連線。';
  }
}

export function polishStyleModelHint(settings: AppSettings): string | null {
  return effectivePolishStyle(settings) === 'cantonese' && !settings.polish.model.includes('27B')
    ? '目前模型較常改錯粵語口語，建議改用 Qwen3.8-27B。' : null;
}

export function polishModelOptions(models: readonly string[], current: string, preferred?: string): { id: string; label: string }[] {
  const installed = new Set(models);
  const options: { id: string; label: string }[] = [];
  for (const { id, label } of RECOMMENDED_POLISH_MODELS) {
    if (installed.delete(id)) options.push({ id, label: `${id} · ${label}` });
  }
  for (const id of [...installed].sort((a, b) => a.localeCompare(b))) options.push({ id, label: id });
  if (current && !models.includes(current)) options.push({ id: current, label: `${current}（未安裝）` });
  return preferred ? options.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)) : options;
}

const reportNumbers = new Intl.NumberFormat('zh-Hant', { maximumFractionDigits: 0 });
export function formatReportNumber(value: number): string {
  return Number.isFinite(value) ? reportNumbers.format(value) : '—';
}

/** Report durations use whole seconds below a minute, otherwise whole minutes. */
export function formatReportDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${formatReportNumber(Math.floor(minutes / 60))} 小時 ${formatReportNumber(minutes % 60)} 分`;
  if (minutes > 0) return `${formatReportNumber(minutes)} 分鐘`;
  return `${formatReportNumber(seconds)} 秒`;
}
