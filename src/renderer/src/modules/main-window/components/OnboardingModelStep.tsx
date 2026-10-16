import { useEffect, useRef, useState } from 'react';
import { onboardingRecommendations } from '../../../../../shared/lib/onboarding';
import type { AppSettingsPatch } from '../../../../../shared/types/settings';
import { useSettings } from '../hooks/SettingsContext';
import { useModelDownloads } from '../hooks/useModelDownloads';
import { formatModelSize, formatReportDuration } from '../lib/format';

const onModelsChanged = () => undefined;

export function OnboardingModelStep({ active, memoryGb, onNext }: {
  active: boolean; memoryGb: number | null; onNext: (patch?: AppSettingsPatch) => void;
}) {
  const { settings, saving, update } = useSettings();
  const downloads = useModelDownloads(active, settings?.asr.model, onModelsChanged);
  const recommendation = onboardingRecommendations(settings?.onboarding.primaryLanguage ?? null, memoryGb);
  const [choice, setChoice] = useState<string | null>(null);
  const applied = useRef<string | null>(null);
  const transferringKey = useRef<string | null>(null);
  const recommended = downloads.entries.find(entry => entry.key === recommendation.catalogKey);
  const installed = downloads.entries.filter(entry => entry.installed && entry.modelId);
  const selectedKey = choice ?? (recommended?.installed ? recommended.key : installed[0]?.key) ?? recommended?.key ?? downloads.entries[0]?.key;
  const selected = downloads.entries.find(entry => entry.key === selectedKey);

  // A completed transfer is already verified by M2. Wait for its catalog model ID,
  // including downloads that continue while another wizard step is visible.
  const completed = downloads.entries.find(entry => entry.key === downloads.progress?.key
    && downloads.progress.state === 'completed' && entry.installed && entry.modelId);
  useEffect(() => {
    if (downloads.progress && ['idle', 'downloading', 'verifying'].includes(downloads.progress.state)) {
      transferringKey.current = downloads.progress.key;
    }
    if (!completed?.modelId || transferringKey.current !== completed.key || saving || applied.current === completed.modelId) return;
    applied.current = completed.modelId;
    setChoice(completed.key);
    if (settings?.asr.model !== completed.modelId) void update({ asr: { model: completed.modelId } });
  }, [completed?.key, completed?.modelId, downloads.progress, saving, settings?.asr.model, update]);

  useEffect(() => { setChoice(null); }, [settings?.onboarding.primaryLanguage]);

  // Keep transfer subscriptions alive without exposing controls from another step.
  if (!active) return null;

  const renderCard = (entry: typeof downloads.entries[number]) => {
    const progress = downloads.progress?.key === entry.key ? downloads.progress : null;
    const transferring = progress?.state === 'downloading' || progress?.state === 'verifying';
    const partial = Math.max(entry.partialBytes, progress?.state === 'cancelled' ? progress.receivedBytes : 0);
    const error = downloads.errors[entry.key] ?? (progress?.state === 'failed' ? progress.error : null);
    const percent = Math.min(100, Math.floor((progress?.receivedBytes ?? partial) / entry.size * 100));
    return <div className="card onboarding-model" key={entry.key} data-testid={`onboarding-model-${entry.key}`}>
      <label className="onboarding-model-choice">
        <input type="radio" name="onboarding-model" value={entry.key} checked={selectedKey === entry.key}
          disabled={saving || downloads.downloading || downloads.pending} onChange={() => setChoice(entry.key)} />
        <strong>{entry.title}</strong>
        {entry.key === recommendation.catalogKey && <span className="badge model-recommended">推薦</span>}
      </label>
      <p className="muted help">{formatModelSize(entry.size)} · {entry.license}</p>
      <p>{entry.description}</p>
      {entry.credit && <p className="muted help">{entry.credit}</p>}
      {entry.installed && <p className="model-installed">已安裝</p>}
      {transferring && <div role="status">
        <progress data-testid="onboarding-download-progress" max={100} value={percent} aria-label={`${entry.title}下載進度`} />
        <p className="muted help">{progress.state === 'verifying' ? '正在驗證檔案…'
          : `${formatModelSize(progress.receivedBytes)} / ${formatModelSize(entry.size)} · ${formatModelSize(progress.bytesPerSecond)}/秒 · 剩餘 ${formatReportDuration(progress.etaSeconds === null ? null : progress.etaSeconds * 1000)}`}</p>
      </div>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {transferring ? <button data-testid={`onboarding-model-cancel-${entry.key}`} disabled={downloads.pending}
        onClick={() => { void downloads.run(entry.key, () => window.api.models.cancel()); }}>取消</button>
        : !entry.installed && <button className={selectedKey === entry.key ? 'primary' : undefined} data-testid={`onboarding-model-download-${entry.key}`} disabled={saving || downloads.pending || downloads.downloading}
          onClick={() => { setChoice(entry.key); transferringKey.current = entry.key; applied.current = null; void downloads.run(entry.key, () => window.api.models.start(entry.key)); }}>
          {partial > 0 ? `繼續下載（${Math.floor(partial / entry.size * 100)}%）` : error ? '重試下載' : '下載'}
        </button>}
    </div>;
  };
  const prominent = downloads.entries.filter(entry => entry.key === recommendation.catalogKey
    || entry.key === recommendation.lighterCatalogKey || entry.installed
    || (!recommended && installed.length === 0 && entry === downloads.entries[0]));
  const others = downloads.entries.filter(entry => !prominent.includes(entry));

  return <>
    <p>選擇辨識模型，下載後即可離線聽寫。</p>
    {recommendation.lighterCatalogKey && <p className="notice">這台 Mac 的記憶體少於 8 GB，也可以選擇較省記憶體的多語言輕量版。</p>}
    {downloads.error && <p role="alert" className="error-text">{downloads.error} <button onClick={() => { void downloads.refresh(); }}>重試</button></p>}
    {downloads.entries.length === 0 && !downloads.error && <p role="status">正在讀取模型…</p>}
    <div role="group" aria-label="辨識模型">
      {prominent.map(renderCard)}
      {others.length > 0 && <details><summary>其他選擇</summary>{others.map(renderCard)}</details>}
    </div>
    <div className="onboarding-actions">
      <button className="primary" data-testid="onboarding-next" disabled={saving || !selected?.installed || !selected.modelId}
        onClick={() => onNext({ asr: { model: selected?.modelId ?? null } })}>
        {selected?.modelId && settings?.asr.model === selected.modelId ? '下一步' : '使用這個模型'}
      </button>
      <button data-testid="onboarding-skip" disabled={saving} onClick={() => onNext()}>稍後再說</button>
    </div>
    <p className="muted help">沒有辨識模型時無法聽寫。</p>
  </>;
}
