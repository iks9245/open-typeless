import { useEffect, useState } from 'react';
import type { DiagnosticsSummary } from '../../../../../shared/types/diagnostics';

export function useDiagnosticsSummary(active: boolean) {
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void window.api.diagnostics.summary().then(result => {
      if (cancelled) return;
      if (result.success) { setSummary(result.data); setError(null); }
      else setError(result.error);
    }).catch(() => { if (!cancelled) setError('無法讀取版本資訊'); });
    return () => { cancelled = true; };
  }, [active]);
  return { summary, error };
}
