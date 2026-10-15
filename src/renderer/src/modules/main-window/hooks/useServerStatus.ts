import { useEffect, useState } from 'react';
import type { WhisperServerInfo } from '../../../../../shared/types/whisper-server';
import { errorMessage } from '../lib/format';

export function useServerStatus(active: boolean) {
  const [status, setStatus] = useState<WhisperServerInfo | null>(null);
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
        const result = await window.api.whisperServer.getStatus();
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setStatus(result.data);
        setError(null);
      } catch (error) {
        if (!cancelled) setError(`無法讀取伺服器狀態：${errorMessage(error)}`);
      } finally {
        busy = false;
        if (!cancelled) setPending(false);
      }
    };
    const onVisibility = () => { void refresh(); };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 3000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  return { status, error, pending };
}
