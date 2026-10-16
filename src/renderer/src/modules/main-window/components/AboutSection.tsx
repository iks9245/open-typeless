import { useRef, useState } from 'react';
import { FEEDBACK_URL } from '../../../../../shared/constants/support';
import { useDiagnosticsSummary } from '../hooks/useDiagnosticsSummary';
import { useMounted } from '../hooks/useMounted';
import { useSettings } from '../hooks/SettingsContext';
import { versionEntries, formatVersionInfo } from '../lib/format';

export function AboutSection({ active }: { active: boolean }) {
  const { summary, error } = useDiagnosticsSummary(active);
  const { report } = useSettings();
  const mounted = useMounted();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(formatVersionInfo(summary));
      if (mounted.current) { setCopied(true); report('已複製'); }
    } catch { if (mounted.current) report('無法複製版本資訊，請再試一次。', true); }
  };
  const exportDiagnostics = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await window.api.diagnostics.export();
      if (!mounted.current) return;
      if (!result.success) { report(result.error, true); return; }
      if (result.data.saved) setFileName(result.data.fileName);
    } catch { if (mounted.current) report('無法匯出診斷資料，請再試一次。', true); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  const open = async (action: 'reveal' | 'feedback') => {
    try {
      const result = await window.api.diagnostics[action]();
      if (mounted.current && !result.success) report(result.error, true);
    } catch { if (mounted.current) report('無法開啟，請再試一次。', true); }
  };

  return <section className="settings-section" aria-labelledby="about-heading">
    <h2 id="about-heading" data-testid="about-heading">關於與支援</h2>
    <div className="card about-card">
      {error && <p className="error-text" role="alert">{error}</p>}
      {summary ? <dl className="about-versions" data-testid="about-versions">
        {versionEntries(summary).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl> : !error && <p className="muted" role="status">正在讀取版本資訊…</p>}
      <div className="inline-actions"><button data-testid="about-copy" disabled={!summary} onClick={() => { void copy(); }}>{copied ? '已複製' : '複製版本資訊'}</button></div>
      <p className="muted help">包含版本、設定（不含詞彙表內容）、伺服器與權限狀態、最近 50 次聽寫的時間與錯誤代碼，以及記錄檔。不含任何聽寫文字、錄音、詞彙表內容或金鑰。</p>
      <div className="inline-actions">
        <button data-testid="about-export-diagnostics" disabled={pending} onClick={() => { void exportDiagnostics(); }}>{pending ? '正在匯出…' : '匯出診斷資料'}</button>
        {FEEDBACK_URL && <button data-testid="about-feedback" onClick={() => { void open('feedback'); }}>回報問題</button>}
      </div>
      {fileName && <div className="inline-actions about-saved" data-testid="about-export-saved" role="status">
        <span>已儲存 {fileName}</span><button data-testid="about-reveal" disabled={pending} onClick={() => { void open('reveal'); }}>在 Finder 中顯示</button>
      </div>}
    </div>
  </section>;
}
