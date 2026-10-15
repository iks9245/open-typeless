import { triggerKeyLabel } from '../../../../../shared/constants/keyboard';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useHistory, type HistoryFilter } from '../hooks/useHistory';
import { useSettings } from '../hooks/SettingsContext';
import { useMounted } from '../hooks/useMounted';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { errorMessage } from '../lib/format';
import { HistoryItem } from './HistoryItem';

export function HistoryPanel({ openSettings }: { openSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const busy = useRef(false);
  const mounted = useMounted();
  const { settings, report } = useSettings();
  const history = useHistory(debouncedQuery, filter);
  const showLoading = useDelayedLoading(!history.loaded && history.pending);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const changeFilter = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === 'all' || value === 'completed' || value === 'empty' || value === 'failed') setFilter(value);
  };

  const clear = async () => {
    if (busy.current) return;
    busy.current = true;
    setClearing(true);
    try {
      const result = await window.api.history.clear();
      if (!mounted.current) return;
      if (!result.success) throw new Error(result.error);
      report(`已清除 ${result.data.deleted} 筆紀錄`);
      setConfirmClear(false);
      history.scheduleRefresh();
    } catch (error) {
      if (mounted.current) report(`清除失敗：${errorMessage(error)}`, true);
    } finally {
      busy.current = false;
      if (mounted.current) setClearing(false);
    }
  };

  return (
    <div className="panel-content">
      <div className="section-heading">
        <div><h1>歷史紀錄</h1><p className="muted">找回每一次聽寫，隨時複製與整理。</p></div>
        <div className="inline-actions clear-actions">
          {confirmClear ? <>
            <span>清除所有紀錄與錄音？</span>
            <button className="danger" data-testid="history-clear-confirm" disabled={clearing} onClick={() => { void clear(); }}>確認清除</button>
            <button disabled={clearing} onClick={() => setConfirmClear(false)}>取消</button>
          </> : <button data-testid="history-clear" disabled={clearing} onClick={() => setConfirmClear(true)}>清除全部</button>}
        </div>
      </div>
      {settings?.history.enabled === false && <div className="notice" data-testid="history-disabled-notice">
        歷史紀錄已停用，新的聽寫不會保存。<button className="text-button" onClick={openSettings}>前往設定</button>
      </div>}
      <div className="history-toolbar">
        <label className="search-field"><span className="sr-only">搜尋歷史紀錄</span>
          <input type="search" data-testid="history-search" placeholder="搜尋聽寫文字…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label><span className="sr-only">篩選紀錄狀態</span>
          <select data-testid="history-status-filter" value={filter} onChange={changeFilter}>
            <option value="all">全部</option><option value="completed">完成</option>
            <option value="empty">沒有文字</option><option value="failed">失敗</option>
          </select>
        </label>
      </div>
      {history.error && <div className="notice error-text" role="alert">{history.error} <button onClick={history.retry}>重試</button></div>}
      {showLoading && <p className="muted" role="status">正在讀取歷史紀錄…</p>}
      <ul className="history-list" data-testid="history-list" aria-busy={history.pending}>
        {history.items.map((item) => <HistoryItem key={item.id} item={item} onDeleted={history.scheduleRefresh} />)}
      </ul>
      {history.loaded && !history.pending && !history.error && history.items.length === 0 && <div className="empty-state" data-testid="history-empty">
        <div className="empty-symbol" aria-hidden="true">⌥</div>
        <h2>{debouncedQuery || filter !== 'all' ? '沒有符合條件的紀錄' : '開始你的第一次聽寫'}</h2>
        <p>{debouncedQuery || filter !== 'all' ? '試試其他關鍵字或狀態篩選。' : `按住${triggerKeyLabel(settings?.input.triggerKey)} 鍵開始聽寫，放開後完成辨識。`}</p>
      </div>}
      {history.nextCursor && <div className="load-more"><button data-testid="history-load-more" disabled={history.pending || query !== debouncedQuery} onClick={history.loadMore}>載入更多</button></div>}
    </div>
  );
}
