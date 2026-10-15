import { useEffect, useState } from 'react';
import type { PolishInfo } from '../../../../../shared/types/polish';
import { errorMessage } from '../lib/format';

export function usePolishStatus(active: boolean) {
  const [status, setStatus] = useState<PolishInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let busy = false;
    const refresh = async () => {
      if (cancelled || busy || document.hidden) return;
      busy = true;
      setPending(true);
      try {
        const result = await window.api.polish.getStatus();
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setStatus(result.data);
        setError(null);
      } catch (error) {
        if (!cancelled) setError(`無法讀取 oMLX 狀態：${errorMessage(error)}`);
      } finally {
        busy = false;
        if (!cancelled) setPending(false);
      }
    };
    const onVisibility = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  return { status, error, pending };
}
