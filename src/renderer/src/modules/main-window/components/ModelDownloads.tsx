import { useState } from 'react';
import { useSettings } from '../hooks/SettingsContext';
import { useModelDownloads } from '../hooks/useModelDownloads';
import { formatModelSize, formatReportDuration } from '../lib/format';

export function ModelDownloads({ active, onModelsChanged, modelLocked }: {
  active: boolean; onModelsChanged: () => void; modelLocked: boolean;
}) {
  const { settings, saving, update } = useSettings();
  const downloads = useModelDownloads(active, settings?.asr.model, onModelsChanged);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const recommended = settings?.asr.language === 'yue' ? 'cantonese' : 'general';
  return <div className="card model-downloads" aria-labelledby="model-downloads-heading">
    <h3 id="model-downloads-heading">下載模型</h3>
    {downloads.error && <p className="error-text" role="alert">{downloads.error} <button onClick={() => { void downloads.refresh(); }}>重試</button></p>}
    {downloads.entries.map(entry => {
      const progress = downloads.progress?.key === entry.key ? downloads.progress : null;
      const downloading = progress?.state === 'downloading';
      const verifying = progress?.state === 'verifying';
      const partial = progress?.state === 'cancelled' ? Math.max(entry.partialBytes, progress.receivedBytes) : entry.partialBytes;
      const percent = Math.min(100, Math.floor((progress?.receivedBytes ?? partial) / entry.size * 100));
      const error = downloads.errors[entry.key] ?? (progress?.state === 'failed' ? progress.error : null);
      const busy = downloads.pending || downloads.downloading;
      return <div className="model-download-row" key={entry.key} data-testid={`model-row-${entry.key}`}>
        <div className="model-download-heading"><strong>{entry.title}</strong>
          {entry.recommendedFor === recommended && <span className="badge model-recommended">推薦</span>}
        </div>
        <p className="muted help">{formatModelSize(entry.size)} · {entry.license}</p>
        <p className="help">{entry.description}</p>
        {entry.credit && <p className="muted help">{entry.credit}</p>}
        {downloading && <div className="model-download-status" role="status">
          <div className="model-download-progress" data-testid="model-download-progress" role="progressbar" aria-label={entry.title}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div style={{ width: `${percent}%` }} />
          </div>
          <p className="muted help">{formatModelSize(progress.receivedBytes)} / {formatModelSize(entry.size)} · {formatModelSize(progress.bytesPerSecond)}/秒 · 剩餘 {formatReportDuration(progress.etaSeconds === null ? null : progress.etaSeconds * 1000)}</p>
        </div>}
        {verifying && <p role="status">正在驗證檔案…</p>}
        {error && <p className="error-text help" role="alert">{error}</p>}
        <div className="inline-actions model-download-actions">
          {downloading || verifying ? <button data-testid={`model-cancel-${entry.key}`} disabled={downloads.pending}
            onClick={() => { void downloads.run(entry.key, () => window.api.models.cancel()); }}>取消</button>
            : entry.installed && entry.modelId ? <>
              <span className="model-installed" data-testid={`model-installed-${entry.key}`}>已安裝 · {entry.modelId.startsWith('app/') ? 'app' : 'whisper.cpp'}</span>
              {!entry.active && <button data-testid={`model-use-${entry.key}`} disabled={!settings || saving || modelLocked}
                onClick={() => { void update({ asr: { model: entry.modelId } }); }}>使用這個模型</button>}
              {entry.modelId.startsWith('app/') && (confirmDelete === entry.key ? <div className="inline-actions model-delete-confirm" role="alertdialog" aria-label="刪除模型" aria-describedby={`model-delete-detail-${entry.key}`}>
                <span id={`model-delete-detail-${entry.key}`}>刪除 {entry.fileName}（{formatModelSize(entry.size)}）？</span>
                <button className="danger" data-testid={`model-delete-confirm-${entry.key}`} disabled={busy}
                  onClick={() => { void downloads.run(entry.key, () => window.api.models.delete(entry.modelId ?? ''), true).then(success => { if (success) setConfirmDelete(null); }); }}>確認刪除</button>
                <button disabled={downloads.pending} onClick={() => setConfirmDelete(null)}>取消</button>
              </div> : <button data-testid={`model-delete-${entry.key}`} disabled={busy} onClick={() => setConfirmDelete(entry.key)}>刪除</button>)}
            </> : <>
              <button data-testid={`model-start-${entry.key}`} disabled={busy} onClick={() => { void downloads.run(entry.key, () => window.api.models.start(entry.key)); }}>
                {error ? '重試' : partial > 0 ? `繼續下載（${Math.floor(partial / entry.size * 100)}%）` : '下載'}
              </button>
              {partial > 0 && <button className="text-button" data-testid={`model-discard-${entry.key}`} disabled={busy}
                onClick={() => { void downloads.run(entry.key, () => window.api.models.discard(entry.key)); }}>捨棄</button>}
            </>}
        </div>
      </div>;
    })}
  </div>;
}
