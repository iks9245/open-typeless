import { useRef, useState, type KeyboardEvent } from 'react';
import { SettingsProvider, useSettings } from '../hooks/SettingsContext';
import { HistoryPanel } from './HistoryPanel';
import { VocabularyPanel } from './VocabularyPanel';
import { SettingsPanel } from './SettingsPanel';

const TABS = [
  { id: 'history', label: '歷史紀錄' },
  { id: 'vocabulary', label: '詞彙表' },
  { id: 'settings', label: '設定' },
] as const;
type Tab = typeof TABS[number]['id'];

function AppContent() {
  const [tab, setTab] = useState<Tab>('history');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { loadError, reload, saveStatus } = useSettings();

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return <div className="main-window">
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">⌥</span><strong>Open Typeless</strong></div>
      <nav role="tablist" aria-label="主視窗分頁">{TABS.map((item, index) => <button key={item.id}
        ref={(element) => { tabRefs.current[index] = element; }} id={`tab-${item.id}`} data-testid={`tab-${item.id}`}
        role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)} onKeyDown={(event) => navigateTabs(event, index)}>{item.label}</button>)}</nav>
    </header>
    {loadError && <div className="notice global-error error-text" role="alert">{loadError} <button onClick={() => { void reload(); }}>重試</button></div>}
    <main>
      <section role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden={tab !== 'history'} tabIndex={0}>
        <HistoryPanel openSettings={() => { setTab('settings'); tabRefs.current[2]?.focus(); }} />
      </section>
      <section role="tabpanel" id="panel-vocabulary" aria-labelledby="tab-vocabulary" hidden={tab !== 'vocabulary'} tabIndex={0}><VocabularyPanel /></section>
      <section role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" hidden={tab !== 'settings'} tabIndex={0}><SettingsPanel active={tab === 'settings'} /></section>
    </main>
    <footer className="app-footer"><span className="muted">按住右 Option 鍵開始聽寫</span>
      <span data-testid="save-status" role="status" aria-live="polite" aria-atomic="true" className={saveStatus.error ? 'error-text' : 'save-status'}>{saveStatus.message}</span>
    </footer>
  </div>;
}

export function App() {
  return <SettingsProvider><AppContent /></SettingsProvider>;
}
