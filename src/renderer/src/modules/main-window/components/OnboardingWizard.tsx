import { useCallback, useEffect, useRef, useState } from 'react';
import { ONBOARDING_STEPS, type AppSettingsPatch, type OnboardingStep, type PrimaryLanguage } from '../../../../../shared/types/settings';
import { isRecentOnboardingTrial, onboardingRecommendations } from '../../../../../shared/lib/onboarding';
import { triggerKeyLabel } from '../../../../../shared/constants/keyboard';
import { useSettings } from '../hooks/SettingsContext';
import { usePermissions } from '../hooks/usePermissions';
import { useServerStatus } from '../hooks/useServerStatus';
import { useLoginItem } from '../hooks/useLoginItem';
import { serverStateLabel } from '../lib/format';
import { OnboardingModelStep } from './OnboardingModelStep';
import { OnboardingAiStep } from './OnboardingAiStep';

const TITLES: Record<OnboardingStep, string> = {
  welcome: '歡迎使用 Open Typeless', model: '準備辨識模型', microphone: '允許使用麥克風',
  accessibility: '開啟輔助使用權限', try: '試著說一句話', ai: '啟用 AI 功能（選用）', done: '準備好了！',
};
const LANGUAGES: { id: PrimaryLanguage; label: string }[] = [
  { id: 'yue', label: '粵語' }, { id: 'zh', label: '普通話／國語' }, { id: 'en', label: 'English' }, { id: 'other', label: '其他語言' },
];

export function OnboardingWizard() {
  const { settings, saving, saveStatus, update } = useSettings();
  const step = settings?.onboarding.step ?? 'welcome';
  const index = ONBOARDING_STEPS.indexOf(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [memoryGb, setMemoryGb] = useState<number | null>(null);
  const [trial, setTrial] = useState('');
  const [historySuccess, setHistorySuccess] = useState(false);
  const permissions = usePermissions(['microphone', 'accessibility', 'try'].includes(step));
  const server = useServerStatus(step === 'try', settings?.asr.model);
  const login = useLoginItem(step === 'done');
  const trigger = triggerKeyLabel(settings?.input.triggerKey);
  const success = Boolean(trial.trim()) || historySuccess;

  const go = useCallback((next: OnboardingStep, patch: AppSettingsPatch = {}) => {
    if (!saving) void update({ ...patch, onboarding: { ...patch.onboarding, completed: false, step: next } });
  }, [saving, update]);
  const next = (patch?: AppSettingsPatch) => go(ONBOARDING_STEPS[index + 1] ?? 'done', patch);

  useEffect(() => {
    heading.current?.focus();
    // Announce the heading first, then put the dictation target at the insertion point.
    if (step === 'try') {
      const frame = window.requestAnimationFrame(() => input.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [step]);

  useEffect(() => {
    let cancelled = false;
    void window.api.system.info().then(result => {
      if (!cancelled && result.success === true) setMemoryGb(result.data.totalMemoryGb);
    }).catch(() => { /* Keep conservative recommendations if OS information is unavailable. */ });
    return () => { cancelled = true; };
  }, []);

  const granted = step === 'microphone' ? permissions.status?.microphone === 'granted'
    : step === 'accessibility' && permissions.status?.accessibility === true;
  useEffect(() => {
    if (!granted || permissions.error || saving) return;
    const timer = window.setTimeout(() => go(step === 'microphone' ? 'accessibility' : 'try'), 600);
    return () => window.clearTimeout(timer);
  }, [granted, permissions.error, saving, step, go]);

  useEffect(() => {
    if (step !== 'try') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await window.api.history.list({ limit: 1 });
        if (cancelled || result.success === false) return;
        const item = result.data.items[0];
        if (isRecentOnboardingTrial(item)) setHistorySuccess(true);
      } catch { /* The textarea also works when history storage is unavailable. */ }
    };
    const unsubscribe = window.api.history.onChanged(() => { void refresh(); });
    void refresh();
    return () => { cancelled = true; unsubscribe(); };
  }, [step]);

  const chooseLanguage = (language: PrimaryLanguage) => {
    const recommendation = onboardingRecommendations(language, memoryGb);
    void update({ onboarding: { primaryLanguage: language, step: 'welcome' }, asr: { language: recommendation.asrLanguage }, polish: { style: recommendation.polishStyle } });
  };
  const unavailableMicrophone = permissions.status?.microphone !== 'granted';

  return <div className="main-window onboarding" data-testid="onboarding-wizard">
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">⌥</span><strong>Open Typeless</strong></div>
      <p data-testid="onboarding-progress" role="status" aria-live="polite" aria-atomic="true">第 {index + 1}／7 步</p>
    </header>
    <main><section className="onboarding-content" aria-labelledby="onboarding-heading">
      <h1 id="onboarding-heading" data-testid={`onboarding-step-${step}`} tabIndex={-1} ref={heading}>{TITLES[step]}</h1>
      {step === 'welcome' && <>
        <p>按住一個鍵，說話就能變成文字，輸入到你正在使用的 app。</p>
        <p className="notice">語音和文字都只在這台電腦處理</p>
        <fieldset className="onboarding-languages"><legend>你最常說哪種語言？</legend>
          {LANGUAGES.map(language => <label className="onboarding-language card" key={language.id}>
            <input type="radio" name="primary-language" data-testid={`onboarding-language-${language.id}`} value={language.id}
              checked={settings?.onboarding.primaryLanguage === language.id} disabled={saving}
              onChange={() => chooseLanguage(language.id)} /><span>{language.label}</span>
          </label>)}
        </fieldset>
        <div className="onboarding-actions"><button className="primary" data-testid="onboarding-next" disabled={saving || !settings?.onboarding.primaryLanguage} onClick={() => next()}>下一步</button></div>
      </>}
      <OnboardingModelStep active={step === 'model'} memoryGb={memoryGb} onNext={patch => go('microphone', patch)} />
      {(step === 'microphone' || step === 'accessibility') && <>
        <p>{step === 'microphone' ? '需要麥克風來聽見你說的話，錄音只在這台電腦處理。' : '輔助使用權限用來偵測快捷鍵，並將文字輸入到游標位置。'}</p>
        <p className="notice" role="status" data-testid="onboarding-permission-status">
          {granted ? '已允許，即將前往下一步…' : permissions.status ? '尚未允許' : '正在檢查權限…'}
        </p>
        {permissions.error && <p className="error-text" role="alert">{permissions.error}</p>}
        {step === 'accessibility' && <ol>
          <li>打開「系統設定」→「隱私權與安全性」→「輔助使用」。</li>
          <li>開啟 Open Typeless 的開關。</li>
          <li>回到這裡，允許後會自動繼續，不需重新啟動。</li>
        </ol>}
        {step === 'microphone' && ['denied', 'restricted', 'unknown'].includes(permissions.status?.microphone ?? '') &&
          <p>麥克風權限尚未允許，請到「隱私權與安全性」→「麥克風」開啟 Open Typeless。</p>}
        <div className="onboarding-actions">
          <button className="primary" data-testid="onboarding-permission-request" disabled={saving || permissions.pending || !permissions.status || Boolean(granted)}
            onClick={() => { void permissions.request(step === 'microphone' ? 'microphone' : 'accessibility', step === 'accessibility' || permissions.status?.microphone !== 'not-determined'); }}>
            {step === 'microphone' && permissions.status?.microphone === 'not-determined' ? '允許使用麥克風' : '打開系統設定'}
          </button>
          <button data-testid="onboarding-skip" disabled={saving} onClick={() => next()}>略過</button>
        </div>
        <p className="muted help">{step === 'microphone' ? '略過後無法錄音，可以稍後在設定開啟權限。' : '略過後無法使用快捷鍵或自動輸入文字，可以稍後開啟權限。'}</p>
      </>}
      {step === 'try' && <>
        <p>按住 {trigger} 說一句話，放開後文字會出現在下面。</p>
        <label htmlFor="onboarding-try-input">試試聽寫</label>
        <textarea id="onboarding-try-input" data-testid="onboarding-try-input" ref={input} value={trial} onChange={event => setTrial(event.target.value)} placeholder="你說的文字會出現在這裡…" />
        <p role="status" data-testid="onboarding-server-status">辨識伺服器：{server.status ? serverStateLabel(server.status.state) : '正在檢查…'}
          {server.status?.reason && ` · ${server.status.reason}`}</p>
        {server.error && <p className="error-text" role="alert">{server.error}</p>}
        {permissions.error && <p className="error-text" role="alert">{permissions.error}</p>}
        {(server.status?.state !== 'ready' || unavailableMicrophone || !permissions.status?.accessibility) && <div className="notice">
          <p>完成以下項目就能開始聽寫：</p>
          <ul>
            {server.status?.state !== 'ready' && <li>辨識模型尚未就緒。<button className="text-button" disabled={saving} onClick={() => go('model')}>檢查模型</button></li>}
            {unavailableMicrophone && <li>尚未允許麥克風。<button className="text-button" disabled={saving} onClick={() => go('microphone')}>設定麥克風</button></li>}
            {!permissions.status?.accessibility && <li>尚未允許輔助使用。<button className="text-button" disabled={saving} onClick={() => go('accessibility')}>設定輔助使用</button></li>}
          </ul>
        </div>}
        {success && <p className="model-installed" role="status" data-testid="onboarding-try-success">成功！</p>}
        <div className="onboarding-actions"><button className="primary" data-testid="onboarding-next" disabled={saving || !success} onClick={() => next()}>下一步</button>
          <button data-testid="onboarding-skip" disabled={saving} onClick={() => next()}>略過</button></div>
      </>}
      {step === 'ai' && <OnboardingAiStep memoryGb={memoryGb} onNext={next} />}
      {step === 'done' && <>
        <p>隨時按住快捷鍵開始，放開就能完成。</p>
        <dl className="card onboarding-shortcuts"><div><dt>聽寫</dt><dd>{trigger}</dd></div>
          <div><dt>指令</dt><dd>Shift + {trigger}</dd></div><div><dt>提問</dt><dd>Control + {trigger}</dd></div></dl>
        {login.state?.supported && <div className="card"><label className="setting-row"><span>開機時自動啟動</span>
          <input type="checkbox" role="switch" data-testid="onboarding-login-item" checked={login.state.enabled} disabled={login.pending}
            onChange={event => { void login.setEnabled(event.target.checked); }} /></label>
          {login.state.requiresApproval && <p className="muted help">請在系統設定的「登入項目」允許 Open Typeless。</p>}
        </div>}
        <div className="onboarding-actions"><button className="primary" data-testid="onboarding-finish" disabled={saving || login.pending}
          onClick={() => { void update({ onboarding: { completed: true, step: null } }); }}>開始使用</button></div>
      </>}
    </section></main>
    <footer className="app-footer">
      {index > 0 ? <button data-testid="onboarding-back" disabled={saving} onClick={() => go(ONBOARDING_STEPS[index - 1])}>上一步</button> : <span />}
      <span role="status" aria-live="polite" className={saveStatus.error ? 'error-text' : 'save-status'}>{saveStatus.error ? saveStatus.message : saving ? '儲存中…' : ''}</span>
    </footer>
  </div>;
}
