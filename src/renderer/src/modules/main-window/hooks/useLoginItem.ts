import { useEffect, useRef, useState } from 'react';
import type { LoginItemState } from '../../../../../shared/types/system';
import { errorMessage } from '../lib/format';
import { useSettings } from './SettingsContext';
import { useMounted } from './useMounted';

/** Refresh OS state whenever settings opens; saves use the OS response as confirmation. */
export function useLoginItem(active: boolean) {
  const [state, setState] = useState<LoginItemState | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useMounted();
  const { report } = useSettings();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setPending(true);
    void window.api.system.getLoginItem().then(result => {
      if (cancelled) return;
      if (result.success === false) throw new Error(result.error);
      setState(result.data);
    }).catch(error => {
      if (!cancelled) {
        setState(null);
        report(`無法讀取開機啟動設定：${errorMessage(error)}`, true);
      }
    }).finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [active, report]);

  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (!state?.supported || pending || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await window.api.system.setLoginItem(enabled);
      if (result.success === false) throw new Error(result.error);
      if (mounted.current) {
        setState(result.data);
        report('已儲存');
      }
    } catch (error) {
      if (mounted.current) report(`儲存失敗：${errorMessage(error)}`, true);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { state, pending, setEnabled };
}
