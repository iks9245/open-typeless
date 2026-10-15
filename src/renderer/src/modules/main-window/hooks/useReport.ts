import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReportRange, SpeechReport } from '../../../../../shared/types/report';
import { errorMessage } from '../lib/format';

export function useReport(range: ReportRange, active: boolean) {
  const [report, setReport] = useState<SpeechReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    setPending(true);
    setError(null);
    try {
      const result = await window.api.report.get({ range });
      if (id !== request.current) return;
      if (result.success === false) throw new Error(result.error);
      setReport(result.data);
    } catch (error) {
      if (id === request.current) {
        setReport(null);
        setError(`無法讀取報告：${errorMessage(error)}`);
      }
    } finally {
      if (id === request.current) setPending(false);
    }
  }, [range]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.api.history.onChanged(() => { void refresh(); });
    void refresh();
    return () => {
      request.current++;
      unsubscribe();
    };
  }, [active, refresh]);

  // Do not show a previous range's data while the next request is in flight.
  return { report: report?.range === range ? report : null, error, pending, refresh };
}
