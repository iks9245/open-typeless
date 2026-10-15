import { useRef, useState } from 'react';
import type { TranscriptionItem } from '../../../../../shared/types/history';
import { errorCodeLabel, errorMessage, formatDuration, formatHistoryTime, insertStatusLabel, statusLabel } from '../lib/format';
import { useMounted } from '../hooks/useMounted';
import { useSettings } from '../hooks/SettingsContext';

export function HistoryItem({ item, onDeleted }: { item: TranscriptionItem; onDeleted: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useMounted();
  const { report } = useSettings();
  const text = item.finalText ?? item.rawText ?? '';
  const date = new Date(item.createdAt);
  const polished = Boolean(item.rawText && item.finalText && item.rawText !== item.finalText);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) report('已複製文字');
    } catch (error) {
      if (mounted.current) report(`複製失敗：${errorMessage(error)}`, true);
    }
  };

  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await window.api.history.delete(item.id);
      if (!mounted.current) return;
      if (!result.success) throw new Error(result.error);
      report(result.data.deleted ? '已刪除紀錄' : '這筆紀錄已不存在');
      setConfirmDelete(false);
      onDeleted();
    } catch (error) {
      if (mounted.current) report(`刪除失敗：${errorMessage(error)}`, true);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <li className="history-item" data-testid="history-item" data-id={item.id}>
      <div className="history-item-heading">
        <time dateTime={Number.isFinite(date.getTime()) ? date.toISOString() : undefined}>{formatHistoryTime(item.createdAt)}</time>
        <span className={`badge badge-${item.status}`}>{statusLabel(item.status)}</span>
        {polished && <span className="badge badge-polished" data-testid="history-polished">已潤稿</span>}
      </div>
      <p className={item.status === 'failed' ? 'history-text error-text' : 'history-text'} data-testid="history-text">
        {item.status === 'failed' ? errorCodeLabel(item.errorCode) : text || '沒有辨識到文字'}
      </p>
      {polished && <details className="history-raw" data-testid="history-raw"><summary>原始辨識</summary><p>{item.rawText}</p></details>}
      {item.status === 'failed' && item.errorMessage && <p className="muted error-detail">{item.errorMessage}</p>}
      <div className="history-item-footer">
        <div className="metadata">
          <span>錄音 {formatDuration(item.audioDurationMs)}</span>
          <span>辨識 {formatDuration(item.latencyMs)}</span>
          {insertStatusLabel(item.insertStatus) && <span>{insertStatusLabel(item.insertStatus)}</span>}
        </div>
        <div className="inline-actions">
          <button data-testid="history-copy" disabled={!text || pending} onClick={() => { void copy(); }}>複製</button>
          {confirmDelete ? <>
            <span className="muted">刪除這筆？</span>
            <button className="danger" data-testid="history-delete-confirm" disabled={pending} onClick={() => { void remove(); }}>確認刪除</button>
            <button disabled={pending} onClick={() => setConfirmDelete(false)}>取消</button>
          </> : <button data-testid="history-delete" disabled={pending} onClick={() => setConfirmDelete(true)}>刪除</button>}
        </div>
      </div>
    </li>
  );
}
