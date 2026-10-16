import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelCatalogState, ModelDownloadProgress } from '../../../../../shared/types/model-download';
import type { IpcResult } from '../../../../../shared/types/common';
import { useMounted } from './useMounted';

export function useModelDownloads(active: boolean, selected: string | null | undefined, onModelsChanged: () => void) {
  const [entries, setEntries] = useState<ModelCatalogState[]>([]);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const progressVersion = useRef(0);
  const mounted = useMounted();

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const version = progressVersion.current;
    try {
      const result = await window.api.models.catalog();
      if (!mounted.current || request !== generation.current) return;
      if (!result.success) { setError(result.error); return; }
      setEntries(result.data);
      setError(null);
      // An event received while listing is newer than the listing's state snapshot.
      if (version === progressVersion.current) setProgress(result.data.find(entry => entry.progress)?.progress ?? null);
    } catch { if (mounted.current) setError('無法讀取下載模型'); }
  }, [mounted]);

  useEffect(() => window.api.models.onProgress(next => {
    progressVersion.current++;
    setProgress(next);
    if (['completed', 'failed', 'cancelled', 'idle'].includes(next.state)) {
      void refresh();
      if (next.state === 'completed') onModelsChanged();
    }
  }), [refresh, onModelsChanged]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 3000);
    return () => { window.clearInterval(interval); generation.current++; };
  }, [active, selected, refresh]);

  const run = async (key: string, operation: () => Promise<IpcResult<void>>, modelsChanged = false): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    try {
      const result = await operation();
      if (!result.success) throw new Error(result.error);
      if (modelsChanged) onModelsChanged();
      await refresh();
      return true;
    } catch (error) {
      if (mounted.current) setErrors(previous => ({ ...previous, [key]: error instanceof Error ? error.message : '無法處理模型操作' }));
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const downloading = progress?.state === 'downloading' || progress?.state === 'verifying';
  return { entries, progress, downloading, pending, errors, error, run, refresh };
}
