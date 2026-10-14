import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptionStatus } from '../../../../../shared/constants/history';
import type { TranscriptionItem } from '../../../../../shared/types/history';
import { errorMessage } from '../lib/format';

export type HistoryFilter = 'all' | Extract<TranscriptionStatus, 'completed' | 'empty' | 'failed'>;

export function useHistory(query: string, status: HistoryFilter) {
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const refreshTimer = useRef<number | undefined>(undefined);

  const fetchPage = useCallback(async (cursor?: string) => {
    const id = ++request.current;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await window.api.history.list({
        query, status: status === 'all' ? undefined : status, cursor, limit: 50,
      });
      if (id !== request.current) return;
      if (!result.success) throw new Error(result.error);
      const page = result.data;
      setItems((previous) => cursor
        ? [...previous, ...page.items.filter((item) => !previous.some((existing) => existing.id === item.id))]
        : page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (id === request.current) setError(`無法讀取歷史紀錄：${errorMessage(error)}`);
    } finally {
      if (id === request.current) {
        busy.current = false;
        setPending(false);
        setLoaded(true);
      }
    }
  }, [query, status]);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void fetchPage(); }, 300);
  }, [fetchPage]);

  useEffect(() => {
    const unsubscribe = window.api.history.onChanged(scheduleRefresh);
    void fetchPage();
    return () => {
      request.current++;
      busy.current = false;
      window.clearTimeout(refreshTimer.current);
      unsubscribe();
    };
  }, [fetchPage, scheduleRefresh]);

  const loadMore = () => {
    if (nextCursor && !busy.current) void fetchPage(nextCursor);
  };

  return { items, nextCursor, loaded, pending, error, loadMore, scheduleRefresh, retry: () => { void fetchPage(); } };
}
