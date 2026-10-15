import { DEFAULT_COMMAND_MODEL } from '../../../../../shared/constants/command';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../hooks/SettingsContext';
import { usePolishStatus } from '../hooks/usePolishStatus';
import { useServerStatus } from '../hooks/useServerStatus';
import { useMounted } from '../hooks/useMounted';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { polishModelOptions, polishReasonLabel, serverModeLabel, serverStateLabel } from '../lib/format';

function SettingRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <div className="setting-row"><div><span className="setting-title">{title}</span>{detail && <p className="muted help">{detail}</p>}</div>{children}</div>;
}

export function SettingsPanel({ active }: { active: boolean }) {
  const { settings, loading, saving, update, report } = useSettings();
  const mounted = useMounted();
  const server = useServerStatus(active);
  const polish = usePolishStatus(active);
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
  return (
    <div className="panel-content settings-panel">
      <div className="section-heading"><div><h1>設定</h1><p className="muted">依照你的習慣，調整聽寫體驗。</p></div></div>
      {showLoading && <p className="muted" role="status">正在讀取設定…</p>}
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
              {server.status.binaryName && <div><dt>伺服器程式</dt><dd>{server.status.binaryName}</dd></div>}
              {server.status.reason && <div><dt>原因</dt><dd>{server.status.reason}</dd></div>}
            </dl>}
          </div>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="polish-heading"><h2 id="polish-heading">AI 潤稿</h2><div className="card">
        <SettingRow title="AI 潤稿" detail="用本機 oMLX 模型刪除贅字、補上標點、修正口誤並轉成繁體中文，文字不會離開這台電腦。">
          <input type="checkbox" role="switch" className="switch" aria-label="AI 潤稿" data-testid="settings-polish-enabled"
            checked={settings?.polish.enabled ?? false} disabled={disabled || ((!polish.status?.available || Boolean(polish.error)) && !settings?.polish.enabled)}
            onChange={(event) => { void update({ polish: { enabled: event.target.checked } }); }} />
        </SettingRow>
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
      </div><p className="muted help">按住 Shift + 右 Option 說出指令。有選取文字時依指令改寫並取代；沒有選取時在游標處插入產生的文字。每次約需 2–10 秒。</p></section>
      <section className="settings-section" aria-labelledby="input-heading"><h2 id="input-heading">輸入</h2><div className="card">
        <SettingRow title="自動插入文字" detail="辨識完成後，將文字插入目前使用的應用程式。">
          <input type="checkbox" role="switch" className="switch" aria-label="自動插入文字" data-testid="settings-auto-insert"
            checked={settings?.input.autoInsert ?? false} disabled={disabled} onChange={(event) => { void update({ input: { autoInsert: event.target.checked } }); }} />
        </SettingRow>
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
