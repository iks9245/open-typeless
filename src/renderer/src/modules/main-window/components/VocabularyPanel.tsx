import { useMemo, useState, type FormEvent } from 'react';
import { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH, planVocabularyPrompt } from '../../../../../shared/lib/vocabulary-prompt';
import { useSettings } from '../hooks/SettingsContext';
import { useMounted } from '../hooks/useMounted';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { validateVocabularyTerm } from '../lib/vocabulary';

export function VocabularyPanel() {
  const { settings, loading, saving, update } = useSettings();
  const [input, setInput] = useState('');
  const [attempted, setAttempted] = useState(false);
  const mounted = useMounted();
  const showLoading = useDelayedLoading(loading && !settings);
  const terms = settings?.asr.vocabulary;
  const plan = useMemo(() => planVocabularyPrompt(terms ?? []), [terms]);
  const validation = (input !== '' || attempted) ? validateVocabularyTerm(input, terms ?? []) : null;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!terms || saving) return;
    setAttempted(true);
    if (validateVocabularyTerm(input, terms)) return;
    const success = await update({ asr: { vocabulary: [...terms, input.trim()] } });
    if (success && mounted.current) {
      setInput('');
      setAttempted(false);
    }
  };

  return (
    <div className="panel-content vocabulary-panel">
      <div className="section-heading"><div><h1>詞彙表</h1><p className="muted">讓聽寫更懂你的用語。</p></div>
        <span className="badge" data-testid="vocabulary-count">{terms?.length ?? 0} / {MAX_VOCABULARY_TERMS}</span>
      </div>
      <p>詞彙表可提高專有名詞的辨識率，並讓結果傾向使用繁體中文。</p>
      {showLoading && <p className="muted" role="status">正在讀取詞彙表…</p>}
      <form className="vocabulary-form" onSubmit={(event) => { void add(event); }}>
        <label className="search-field"><span className="sr-only">新增詞彙</span>
          <input data-testid="vocabulary-input" placeholder="輸入人名、產品或專有名詞…" value={input} disabled={!terms || saving}
            aria-invalid={Boolean(validation)} aria-describedby="vocabulary-help vocabulary-error"
            onChange={(event) => { setInput(event.target.value); setAttempted(false); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }} />
        </label>
        <button className="primary" data-testid="vocabulary-add" disabled={!terms || saving} type="submit">新增</button>
      </form>
      <p className="muted help" id="vocabulary-help">每個詞彙最多 {MAX_VOCABULARY_TERM_LENGTH} 字，增刪後自動儲存。</p>
      <p className="error-text validation-message" id="vocabulary-error" data-testid="vocabulary-error" aria-live="polite">{validation}</p>
      <ul className="vocabulary-terms">
        {terms?.map((term) => <li className="vocabulary-chip" key={term} data-testid="vocabulary-term" data-term={term}>
          <span>{term}</span><button data-testid="vocabulary-remove" aria-label={`移除詞彙 ${term}`} disabled={saving}
            onClick={() => { void update({ asr: { vocabulary: terms.filter((value) => value !== term) } }); }}>×</button>
        </li>)}
      </ul>
      {terms?.length === 0 && <p className="muted">還沒有詞彙，新增常用的專有名詞試試看。</p>}
      <section className="card prompt-card" aria-labelledby="prompt-heading">
        <h2 id="prompt-heading">提示句預覽</h2>
        <p className="muted">辨識時會使用以下提示句。</p>
        <p className="prompt-preview" data-testid="vocabulary-preview">{plan.prompt ?? '尚無提示句，新增詞彙後會在這裡顯示。'}</p>
        {plan.skipped.length > 0 && <div className="notice" data-testid="vocabulary-skipped">
          <p>提示句長度已達上限，以下詞彙這次不會送出：</p>
          <ul>{plan.skipped.map((term) => <li key={term}>{term}</li>)}</ul>
        </div>}
      </section>
    </div>
  );
}
