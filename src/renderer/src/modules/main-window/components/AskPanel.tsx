import { useEffect, useRef, useState } from 'react';
import type { AskEntry } from '../../../../../shared/types/memory';
import { useSettings } from '../hooks/SettingsContext';
import { useMemoryStatus, memoryStatusLabel } from '../hooks/useMemoryStatus';
import { usePolishStatus } from '../hooks/usePolishStatus';
import { useMounted } from '../hooks/useMounted';
import { polishReasonLabel } from '../lib/format';

export function AskPanel({ active }: { active: boolean }) {
  const { settings } = useSettings();
  const { status } = useMemoryStatus(active, settings?.memory.enabled);
  const omlx = usePolishStatus(active);
  const [question, setQuestion] = useState('');
  const [entries, setEntries] = useState<AskEntry[]>([]);
  const [selected, setSelected] = useState<AskEntry | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useMounted();
  const composing = useRef(false);
  const sourceRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    let cancelled = false;
    let received = false;
    const unsubscribe = window.api.memory.onAnswered(entry => {
      received = true;
      setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)].slice(0, 20));
      setSelected(entry);
      setHighlight(null);
    });
    void window.api.memory.history().then(result => {
      if (!cancelled && !received && result.success === true) {
        setEntries(result.data);
        setSelected(result.data[0] ?? null);
      }
    }).catch(() => { if (!cancelled) setError('無法讀取本次提問'); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const disabled = settings?.memory.enabled !== true || omlx.status?.available !== true || omlx.error !== null;
  const send = async () => {
    const text = question.trim();
    if (!text || busy.current || disabled || composing.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await window.api.memory.ask({ question: text });
      if (!mounted.current) return;
      if (result.success === false) { setError(result.error); return; }
      // The shared answered event carries the session entry and updates both input paths.
      setQuestion('');
    } catch { if (mounted.current) setError('提問失敗，請稍後再試。'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  const cite = (n: number) => {
    setHighlight(n);
    sourceRefs.current.get(n)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sourceRefs.current.get(n)?.focus({ preventScroll: true });
  };
  const answerParts = selected?.answer.split(/(\[\d+\])/g) ?? [];
  return <div className="panel-content ask-panel" aria-busy={pending}>
    <div className="section-heading"><div><h1>問你的過去</h1><p className="muted">從這台電腦的聽寫紀錄找答案，附上出處。答案只會顯示，不會插入。</p></div></div>
    <p className="muted" role="status">{memoryStatusLabel(status)}</p>
    {disabled && <p className="notice" data-testid="ask-disabled">{settings?.memory.enabled === false ? '請在設定開啟記憶搜尋。' : omlx.error ?? polishReasonLabel(omlx.status?.reason ?? null)}</p>}
    <form className="ask-form" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="ask-question" className="sr-only">問題</label>
      <input id="ask-question" data-testid="ask-input" value={question} maxLength={500} placeholder="我上禮拜跟 Ken 講的報價是多少？"
        disabled={disabled || pending} onChange={event => setQuestion(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            event.preventDefault();
            void send();
          }
        }} />
      <button type="submit" data-testid="ask-submit" disabled={disabled || pending || !question.trim()}>{pending ? '搜尋中…' : '提問'}</button>
    </form>
    {error && <p className="error-text" role="alert">{error}</p>}
    {pending && <p role="status">正在搜尋紀錄並整理答案…</p>}
    {!selected && <div className="empty-state"><h2>想找回說過的事？</h2><p>試試：「昨天討論了什麼？」或「Ken 的報價是多少？」</p></div>}
    {selected && <section className="card report-section" aria-label="答案">
      <h2>{selected.question}</h2>
      <p className="ask-answer" data-testid="ask-answer">{answerParts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        return n && selected.sources.some(source => source.n === Number(n))
          ? <button className="citation" key={i} aria-label={`查看來源 ${n}`} onClick={() => cite(Number(n))}>{part}</button> : part;
      })}</p>
      <h3>依據 {selected.sources.length} 筆紀錄</h3>
      <ol className="ask-sources" data-testid="ask-sources">{[...selected.sources].sort((a, b) => Number(b.cited) - Number(a.cited) || a.n - b.n).map(source =>
        <li key={source.n} tabIndex={-1} ref={element => { if (element) sourceRefs.current.set(source.n, element); else sourceRefs.current.delete(source.n); }}
          className={highlight === source.n ? 'ask-source-highlight' : ''} data-testid={`ask-source-${source.n}`}>
          <span className="citation">[{source.n}]</span> <time dateTime={new Date(source.createdAt).toISOString()}>{new Date(source.createdAt).toLocaleString('zh-TW')}</time>
          <p>{source.snippet}</p>
        </li>)}</ol>
    </section>}
    {entries.length > 0 && <section className="ask-history"><h2>本次提問</h2><p className="muted help">最多保留 20 次，結束應用程式後清除。</p>
      <ul>{entries.map(entry => <li key={entry.id}><button aria-pressed={entry.id === selected?.id} onClick={() => { setSelected(entry); setHighlight(null); }}>{entry.question}</button></li>)}</ul>
    </section>}
  </div>;
}
