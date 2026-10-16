import { useCallback, useEffect, useState } from 'react';
import type { PermissionsStatus, OnboardingPermission } from '../../../../../shared/types/system';
import { errorMessage } from '../lib/format';
import { useMounted } from './useMounted';

/** Poll only while permission or trial guidance is visible; never prompt on a poll. */
export function usePermissions(active: boolean) {
  const [status, setStatus] = useState<PermissionsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useMounted();
  const refresh = useCallback(async () => {
    try {
      const result = await window.api.permissions.status();
      if (!mounted.current) return;
      if (result.success === false) throw new Error(result.error);
      setStatus(result.data);
      setError(null);
    } catch (error) {
      if (mounted.current) setError(`無法讀取權限：${errorMessage(error)}`);
    }
  }, [mounted]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(interval);
  }, [active, refresh]);

  const request = async (type: OnboardingPermission, openSettings = false) => {
    if (pending) return;
    setPending(true);
    try {
      const result = openSettings
        ? await window.api.permissions.openSettings(type)
        : await window.api.permissions.requestMicrophone();
      if (result.success === false) throw new Error(result.error);
      await refresh();
    } catch (error) {
      if (mounted.current) setError(`無法設定權限：${errorMessage(error)}`);
    } finally {
      if (mounted.current) setPending(false);
    }
  };
  return { status, error, pending, request };
}
