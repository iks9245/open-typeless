import { useState } from 'react';
import { onboardingRecommendations } from '../../../../../shared/lib/onboarding';
import type { AppSettingsPatch } from '../../../../../shared/types/settings';
import { usePolishStatus } from '../hooks/usePolishStatus';
import { useSettings } from '../hooks/SettingsContext';
import { polishReasonLabel } from '../lib/format';

export function OnboardingAiStep({ memoryGb, onNext }: {
  memoryGb: number | null; onNext: (patch?: AppSettingsPatch) => void;
}) {
  const { settings, saving } = useSettings();
  const polish = usePolishStatus(true);
  const recommendation = onboardingRecommendations(settings?.onboarding.primaryLanguage ?? null, memoryGb);
  const [polishEnabled, setPolishEnabled] = useState(settings?.polish.enabled ?? false);
  const [commandEnabled, setCommandEnabled] = useState(settings?.command.enabled ?? false);
  const [polishChoice, setPolishChoice] = useState<string | null>(null);
  const [commandChoice, setCommandChoice] = useState<string | null>(null);
  const models = polish.status?.models ?? [];
  const selectModel = (choice: string | null, preferred: string, current?: string) =>
    [choice, preferred, current, models[0]].find(id => id && models.includes(id)) ?? '';
  const polishModel = selectModel(polishChoice, recommendation.polishModel, settings?.polish.model);
  const commandModel = selectModel(commandChoice, recommendation.commandModel, settings?.command.model);
  const available = polish.status?.available === true;
  const nextPatch: AppSettingsPatch = available ? {
    polish: { enabled: polishEnabled && Boolean(polishModel), ...(polishModel ? { model: polishModel } : {}) },
    command: { enabled: commandEnabled && Boolean(commandModel), ...(commandModel ? { model: commandModel } : {}) },
  } : {};

  return <>
    <p>AI 潤稿和指令模式是選用功能，可以稍後再設定。</p>
    {!polish.status && !polish.error && <p role="status">正在檢查 oMLX…</p>}
    {polish.error && <p role="alert" className="error-text">{polish.error}</p>}
    {polish.status && !available && <div className="notice" data-testid="onboarding-ai-unavailable">
      <p>AI 功能需要 oMLX 在這台 Mac 上執行，可稍後在「設定」啟用。</p>
      <p className="muted help">{polishReasonLabel(polish.status.reason)}</p>
    </div>}
    {available && <div className="card">
      <label className="setting-row"><span>AI 潤稿</span><input type="checkbox" role="switch" data-testid="onboarding-polish-enabled"
        checked={polishEnabled && Boolean(polishModel)} disabled={saving || !polishModel} onChange={event => setPolishEnabled(event.target.checked)} /></label>
      <label className="setting-row"><span>潤稿模型</span><select data-testid="onboarding-polish-model" disabled={saving || !models.length}
        value={polishModel} onChange={event => setPolishChoice(event.target.value)}>
        {!models.length && <option value="">尚未安裝模型</option>}
        {models.map(id => <option key={id} value={id}>{id}{id === recommendation.polishModel ? '（推薦）' : ''}</option>)}
      </select></label>
      <label className="setting-row"><span>指令模式</span><input type="checkbox" role="switch" data-testid="onboarding-command-enabled"
        checked={commandEnabled && Boolean(commandModel)} disabled={saving || !commandModel} onChange={event => setCommandEnabled(event.target.checked)} /></label>
      <label className="setting-row"><span>指令模型</span><select data-testid="onboarding-command-model" disabled={saving || !models.length}
        value={commandModel} onChange={event => setCommandChoice(event.target.value)}>
        {!models.length && <option value="">尚未安裝模型</option>}
        {models.map(id => <option key={id} value={id}>{id}{id === recommendation.commandModel ? '（推薦）' : ''}</option>)}
      </select></label>
      <p className="muted help">潤稿推薦 Qwen3.5-9B；指令推薦 {recommendation.commandsLessReliable ? 'Qwen3.5-9B' : 'Qwen3.8-27B'}。</p>
      {recommendation.commandsLessReliable && <p className="muted help">記憶體少於 32 GB 時建議使用 9B 模型，指令的可靠程度較低。</p>}
      {!models.length && <p className="muted help">請先在 oMLX 安裝模型，再到「設定」啟用 AI 功能。</p>}
    </div>}
    <div className="onboarding-actions"><button className="primary" data-testid="onboarding-next" disabled={saving}
      onClick={() => onNext(nextPatch)}>下一步</button></div>
  </>;
}
