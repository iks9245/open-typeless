import { ModelDownloads } from './ModelDownloads';
import { effectivePolishStyle } from '../../../../../shared/lib/polish-style';
import { useMemoryStatus, memoryStatusLabel } from '../hooks/useMemoryStatus';
import { TRIGGER_KEYS, triggerKeyLabel } from '../../../../../shared/constants/keyboard';
import { useLoginItem } from '../hooks/useLoginItem';
import { DEFAULT_COMMAND_MODEL } from '../../../../../shared/constants/command';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../hooks/SettingsContext';
import { usePolishStatus } from '../hooks/usePolishStatus';
import { useServerStatus } from '../hooks/useServerStatus';
import { useMounted } from '../hooks/useMounted';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { formatModelSize, modelLockReason, polishStyleModelHint, polishModelOptions, polishReasonLabel, serverBinaryLabel, serverModeLabel, serverStateLabel } from '../lib/format';

function SettingRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className="setting-row"><div><span className="setting-title">{title}</span>{detail && <p className="muted help">{detail}</p>}</div>{children}</div>;
}

export function SettingsPanel({ active }: { active: boolean }) {
  const { settings, loading, saving, update, report } = useSettings();
  const memory = useMemoryStatus(active, settings?.memory.enabled);
  const [reindexing, setReindexing] = useState(false);
  const reindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    try {
      const result = await window.api.memory.reindex();
      if (mounted.current) report(result.success ? '正在重建索引' : result.error, !result.success);
    } catch { if (mounted.current) report('無法重建索引', true); }
    finally { if (mounted.current) setReindexing(false); }
  };
  const mounted = useMounted();
  const [modelsRevision, setModelsRevision] = useState(0);
  const onModelsChanged = useCallback(() => setModelsRevision(value => value + 1), []);
  const server = useServerStatus(active, settings?.asr.model, modelsRevision);
  const [openingModels, setOpeningModels] = useState(false);
  const openModelsFolder = async () => {
    if (openingModels) return;
    setOpeningModels(true);
    try {
      const result = await window.api.whisperServer.openModelsFolder();
      if (mounted.current && result.success === false) report(result.error, true);
    } catch { if (mounted.current) report('無法打開模型資料夾', true); }
    finally { if (mounted.current) setOpeningModels(false); }
  };
  const polish = usePolishStatus(active);
  const loginItem = useLoginItem(active);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlBusy = useRef(false);
  const showLoading = useDelayedLoading(loading && !settings);
  const showServerLoading = useDelayedLoading(active && server.pending && !server.status);
  const savedUrl = settings?.asr.whisperServerUrl;

  useEffect(() => {
    if (savedUrl !== undefined) setUrl(savedUrl);
  }, [savedUrl]);

  const saveUrl = async () => {
    if (!settings || saving || urlBusy.current) return;
    const next = url.trim();
    if (next === savedUrl) {
      setUrl(next);
      setUrlError(null);
      return;
    }
    if (!/^https?:\/\//.test(next)) {
      const message = '伺服器位址必須以 http:// 或 https:// 開頭。';
      setUrlError(message);
      report(message, true);
      return;
    }
    urlBusy.current = true;
    setUrlError(null);
    const success = await update({ asr: { whisperServerUrl: next } });
    urlBusy.current = false;
    if (mounted.current && !success) setUrl(savedUrl ?? '');
  };

  const disabled = !settings || saving;
  const cantonese = settings && effectivePolishStyle(settings) === 'cantonese';
  const styleModelHint = settings ? polishStyleModelHint(settings) : null;
  const cantoneseModel = [settings?.asr.model, server.status?.modelName].some(name => name?.toLowerCase().includes('cantonese'));
  const modelLocked = server.status?.modelLocked ?? null;
  const selectedMissing = settings?.asr.model && !server.models.some(model => model.id === settings.asr.model);
  return (
    <div className="panel-content settings-panel">
      <div className="section-heading"><div><h1>設定</h1><p className="muted">依照你的習慣，調整聽寫體驗。</p></div></div>
      {showLoading && <p className="muted" role="status">正在讀取設定…</p>}
      <section className="settings-section" aria-labelledby="general-heading">
        <h2 id="general-heading">一般</h2>
        <div className="card"><SettingRow title="設定精靈" detail="重新選擇語言、模型和權限設定。">
          <button data-testid="settings-rerun-onboarding" disabled={disabled}
            onClick={() => { void update({ onboarding: { completed: false, step: 'welcome' } }); }}>重新執行設定精靈</button>
        </SettingRow></div>
      </section>
      <section className="settings-section" aria-labelledby="asr-heading">
        <h2 id="asr-heading">語音辨識</h2>
        <div className="card">
          <div className="setting-row url-row">
            <label className="setting-title" htmlFor="server-url">whisper 伺服器位址</label>
            <div className="url-field"><input id="server-url" data-testid="settings-server-url" type="text" inputMode="url" spellCheck={false}
              value={url} disabled={disabled} aria-invalid={Boolean(urlError)} aria-describedby="server-url-error"
              onChange={(event) => { setUrl(event.target.value); setUrlError(null); }} onBlur={() => { void saveUrl(); }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveUrl(); } }} />
              <p id="server-url-error" className="error-text help" aria-live="polite">{urlError}</p>
            </div>
          </div>
          <SettingRow title="辨識模型" detail={modelLockReason(modelLocked)}>
            <select aria-label="辨識模型" data-testid="settings-asr-model" value={settings?.asr.model ?? ''}
              disabled={disabled || modelLocked !== null}
              onChange={event => { void update({ asr: { model: event.target.value || null } }); }}>
              <option value="">自動（目前：{server.status?.modelName ?? '未提供'}）</option>
              {server.models.map(model => <option key={model.id} value={model.id}>{model.fileName}（{formatModelSize(model.sizeBytes)}） · {model.source}</option>)}
              {selectedMissing && <option value={settings.asr.model ?? ''}>{settings.asr.model?.split('/')[1]}（找不到模型）</option>}
            </select>
          </SettingRow>
          <SettingRow title="模型資料夾">
            <button data-testid="settings-open-models-folder" disabled={openingModels} onClick={() => { void openModelsFolder(); }}>打開模型資料夾</button>
          </SettingRow>
          {server.modelsError && <p className="error-text help" role="alert">{server.modelsError}</p>}
          {server.status?.modelFallback && <p className="muted help" role="status">找不到選擇的模型，暫時使用自動選擇</p>}
          {cantoneseModel && settings?.asr.language === 'yue' && <p className="muted help" data-testid="asr-model-language-hint">粵語模型配合「自動偵測」語言，普通話和英文也能正確辨識。</p>}
          {cantoneseModel && cantonese && <p className="muted help" data-testid="asr-model-polish-hint">粵語模型已直接輸出粵語口語，潤稿風格建議改為「一般」。</p>}
          <SettingRow title="辨識語言">
            <select aria-label="辨識語言" data-testid="settings-language" value={settings?.asr.language ?? ''} disabled={disabled}
              onChange={(event) => { void update({ asr: { language: event.target.value || null } }); }}>
              <option value="">自動偵測</option><option value="zh">中文</option><option value="yue">粵語</option>
              <option value="en">英文</option><option value="ja">日文</option><option value="ko">韓文</option>
            </select>
          </SettingRow>
          <div className="server-status" data-testid="server-status" aria-label="伺服器狀態">
            <div className="server-status-heading"><span className={`status-dot ${server.error ? 'status-failed' : `status-${server.status?.state ?? 'idle'}`}`} aria-hidden="true" />
              <strong>伺服器狀態</strong>
              <span className="muted">{server.status ? `${serverModeLabel(server.status.mode)} · ${serverStateLabel(server.status.state)}` : showServerLoading ? '正在讀取…' : '—'}</span>
            </div>
            {server.error && <p className="error-text" role="alert">{server.error}</p>}
            {server.status && <dl className="server-details">
              <div><dt>模型</dt><dd>{server.status.modelName ?? '未提供'}</dd></div>
              {server.status.vadModelName && <div><dt>語音活動偵測模型</dt><dd>{server.status.vadModelName}</dd></div>}
              {server.status.binaryName && <div><dt>伺服器程式</dt><dd>{serverBinaryLabel(server.status)}</dd></div>}
              {server.status.reason && <div><dt>原因</dt><dd>{server.status.reason}</dd></div>}
            </dl>}
          </div>
        </div>
        <ModelDownloads active={active} onModelsChanged={onModelsChanged} modelLocked={modelLocked !== null} />
      </section>
      <section className="settings-section" aria-labelledby="polish-heading"><h2 id="polish-heading">AI 潤稿</h2><div className="card">
        <SettingRow title="AI 潤稿" detail="用本機 oMLX 模型刪除贅字、補上標點、修正口誤並轉成繁體中文，文字不會離開這台電腦。">
          <input type="checkbox" role="switch" className="switch" aria-label="AI 潤稿" data-testid="settings-polish-enabled"
            checked={settings?.polish.enabled ?? false} disabled={disabled || ((!polish.status?.available || Boolean(polish.error)) && !settings?.polish.enabled)}
            onChange={(event) => { void update({ polish: { enabled: event.target.checked } }); }} />
        </SettingRow>
        <SettingRow title="潤稿風格" detail={cantonese ? '會把辨識結果還原成粵語口語，每句約多 2–3 秒。建議使用 Qwen3.8-27B，9B 較常改錯。' : undefined}>
          <select aria-label="潤稿風格" data-testid="settings-polish-style" value={settings?.polish.style ?? 'auto'} disabled={disabled}
            onChange={(event) => {
              const style = event.target.value;
              if (style === 'auto' || style === 'standard' || style === 'cantonese') void update({ polish: { style } });
            }}>
            <option value="auto">自動（辨識語言是粵語時用粵語口語）</option>
            <option value="standard">一般（整理成書面文字）</option><option value="cantonese">粵語口語</option>
          </select>
        </SettingRow>
        {styleModelHint && <p className="error-text help" data-testid="polish-style-model-hint" role="status">{styleModelHint}</p>}
        <SettingRow title="潤稿模型">
          <select aria-label="潤稿模型" data-testid="settings-polish-model" value={settings?.polish.model ?? ''}
            disabled={disabled || !polish.status?.available || Boolean(polish.error)}
            onChange={(event) => { void update({ polish: { model: event.target.value } }); }}>
            {polishModelOptions(polish.status?.models ?? [], settings?.polish.model ?? '').map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </SettingRow>
        <div className="server-status" data-testid="polish-status" role="status">
          <div className="server-status-heading"><span className={`status-dot status-${polish.status?.available && !polish.error ? 'ready' : 'idle'}`} aria-hidden="true" />
            <span>{polish.error ?? (polish.status ? (polish.status.available ? `已連線 oMLX · ${polish.status.models.length} 個模型` : polishReasonLabel(polish.status.reason)) : '正在讀取…')}</span>
          </div>
        </div>
      </div><p className="muted help">啟用後每次聽寫約多等 0.5–2 秒；連不上 oMLX 或逾時時，會直接插入原始辨識文字。</p></section>
      <section className="settings-section" aria-labelledby="command-heading"><h2 id="command-heading">指令模式</h2><div className="card">
        <SettingRow title="指令模式">
          <input type="checkbox" role="switch" className="switch" aria-label="指令模式" data-testid="settings-command-enabled"
            checked={settings?.command.enabled ?? false} disabled={disabled || ((!polish.status?.available || Boolean(polish.error)) && !settings?.command.enabled)}
            onChange={(event) => { void update({ command: { enabled: event.target.checked } }); }} />
        </SettingRow>
        <SettingRow title="指令模型">
          <select aria-label="指令模型" data-testid="settings-command-model" value={settings?.command.model ?? ''}
            disabled={disabled || !polish.status?.available || Boolean(polish.error)}
            onChange={(event) => { void update({ command: { model: event.target.value } }); }}>
            {polishModelOptions(polish.status?.models ?? [], settings?.command.model ?? '', DEFAULT_COMMAND_MODEL).map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </SettingRow>
      </div><p className="muted help">按住 Shift + {triggerKeyLabel(settings?.input.triggerKey)} 說出指令。有選取文字時依指令改寫並取代；沒有選取時在游標處插入產生的文字。每次約需 2–10 秒。</p></section>
      <section className="settings-section" aria-labelledby="input-heading"><h2 id="input-heading">輸入</h2><div className="card">
        <SettingRow title="聽寫快捷鍵" detail="按住這個鍵聽寫；同時按住 Shift 為指令模式。按住期間按下其他按鍵會取消聽寫，避免和快捷鍵衝突。">
          <select aria-label="聽寫快捷鍵" data-testid="settings-trigger-key" value={settings?.input.triggerKey ?? 'right-option'} disabled={disabled}
            onChange={(event) => {
              const key = TRIGGER_KEYS.find(key => key.id === event.target.value);
              if (key) void update({ input: { triggerKey: key.id } });
            }}>
            {TRIGGER_KEYS.map(key => <option key={key.id} value={key.id}>{key.label}</option>)}
          </select>
        </SettingRow>
        <SettingRow title="開機時自動啟動" detail={loginItem.state?.supported === false ? '只有打包後的 app 支援。' : undefined}>
          <input type="checkbox" role="switch" className="switch" aria-label="開機時自動啟動" data-testid="settings-launch-at-login"
            checked={loginItem.state?.enabled ?? false} disabled={!loginItem.state?.supported || loginItem.pending}
            onChange={(event) => { void loginItem.setEnabled(event.target.checked); }} />
        </SettingRow>
        {loginItem.state?.requiresApproval && <p className="muted help" role="status">請到「系統設定 → 一般 → 登入項目」允許 Open Typeless。</p>}
        <SettingRow title="自動插入文字" detail="辨識完成後，將文字插入目前使用的應用程式。">
          <input type="checkbox" role="switch" className="switch" aria-label="自動插入文字" data-testid="settings-auto-insert"
            checked={settings?.input.autoInsert ?? false} disabled={disabled} onChange={(event) => { void update({ input: { autoInsert: event.target.checked } }); }} />
        </SettingRow>
      </div></section>
      <section className="settings-section" aria-labelledby="memory-heading"><h2 id="memory-heading">記憶搜尋</h2><div className="card">
        <SettingRow title="記憶搜尋" detail="把聽寫紀錄轉成向量存在這台電腦，讓你能用問題搜尋過去說過的話。關閉時會刪除所有向量。">
          <input type="checkbox" role="switch" className="switch" aria-label="記憶搜尋" data-testid="settings-memory-enabled"
            checked={settings?.memory.enabled ?? true} disabled={disabled} onChange={event => { void update({ memory: { enabled: event.target.checked } }); }} />
        </SettingRow>
        <SettingRow title="索引狀態"><span data-testid="memory-status" role="status">{memory.error ?? memoryStatusLabel(memory.status)}</span>
          <button data-testid="memory-reindex" disabled={disabled || !settings?.memory.enabled || reindexing} onClick={() => { void reindex(); }}>重建索引</button>
        </SettingRow>
        <p className="muted help">按住 Control + {triggerKeyLabel(settings?.input.triggerKey)} 用說的提問，答案只會顯示，不會插入。</p>
      </div></section>
      <section className="settings-section" aria-labelledby="history-heading"><h2 id="history-heading">歷史紀錄</h2><div className="card">
        <SettingRow title="記錄歷史" detail="保存每次聽寫的文字與辨識結果。">
          <input type="checkbox" role="switch" className="switch" aria-label="記錄歷史" data-testid="settings-history-enabled"
            checked={settings?.history.enabled ?? false} disabled={disabled} onChange={(event) => { void update({ history: { enabled: event.target.checked } }); }} />
        </SettingRow>
        <SettingRow title="保存錄音" detail="將錄音與歷史紀錄一起保存在這台電腦。">
          <input type="checkbox" role="switch" className="switch" aria-label="保存錄音" data-testid="settings-save-audio"
            checked={settings?.history.saveAudio ?? false} disabled={disabled} onChange={(event) => { void update({ history: { saveAudio: event.target.checked } }); }} />
        </SettingRow>
        <SettingRow title="保留天數">
          <select aria-label="保留天數" data-testid="settings-retention" value={settings?.history.retentionDays ?? ''} disabled={disabled}
            onChange={(event) => { void update({ history: { retentionDays: event.target.value === '' ? null : Number(event.target.value) } }); }}>
            <option value="">永久</option>{[7, 30, 90, 365].map((days) => <option key={days} value={days}>{days} 天</option>)}
          </select>
        </SettingRow>
      </div></section>
    </div>
  );
}
