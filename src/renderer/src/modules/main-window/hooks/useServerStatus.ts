import { useEffect, useState } from 'react';
import type { WhisperModelInfo, WhisperServerInfo } from '../../../../../shared/types/whisper-server';
import { errorMessage } from '../lib/format';

export function useServerStatus(active: boolean, model: string | null | undefined, revision = 0) {
  const [status, setStatus] = useState<WhisperServerInfo | null>(null);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
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
        const [result, catalog] = await Promise.all([
          window.api.whisperServer.getStatus(), window.api.whisperServer.listModels(),
        ]);
        if (cancelled) return;
        if (catalog.success === true) { setModels(catalog.data); setModelsError(null); }
        else setModelsError('無法讀取辨識模型');
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
  }, [active, model, revision]);

  return { status, models, modelsError, error, pending };
}
