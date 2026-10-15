import { useEffect, useState } from 'react';
import type { MemoryStatus } from '../../../../../shared/types/memory';

export function memoryStatusLabel(status: MemoryStatus | null): string {
  if (!status) return '正在讀取索引狀態…';
  if (!status.enabled) return '記憶搜尋已關閉';
  if (status.state === 'indexing') return '正在建立索引…';
  if (status.state === 'paused') return `已暫停：${status.reason ?? 'oMLX 未啟動'}`;
  return `已建立索引 ${status.indexed}／${status.total} 筆`;
}
export function useMemoryStatus(active: boolean, enabled?: boolean) {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let busy = false;
    const refresh = async () => {
      if (cancelled || busy || document.hidden) return;
      busy = true;
      try {
        const result = await window.api.memory.status();
        if (cancelled) return;
        if (result.success === false) { setError(result.error); return; }
        setStatus(result.data);
        setError(null);
      } catch { if (!cancelled) setError('無法讀取索引狀態'); }
      finally { busy = false; }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 2000);
    const onVisibility = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
  }, [active, enabled]);
  return { status, error };
}
