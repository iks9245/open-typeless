import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, AppSettingsPatch } from '../../../../../shared/types/settings';
import { errorMessage } from '../lib/format';
import { useMounted } from './useMounted';

interface SaveStatus { message: string; error: boolean }
interface SettingsContextValue {
  settings: AppSettings | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  saveStatus: SaveStatus;
  reload: () => Promise<void>;
  update: (patch: AppSettingsPatch) => Promise<boolean>;
  report: (message: string, error?: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ message: '', error: false });
  const confirmed = useRef<AppSettings | null>(null);
  const revision = useRef(0);
  const loadRequest = useRef(0);
  const busy = useRef(false);

  const report = useCallback((message: string, error = false) => {
    if (mounted.current) setSaveStatus({ message, error });
  }, [mounted]);

  const reload = useCallback(async () => {
    const request = ++loadRequest.current;
    const version = revision.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await window.api.settings.get();
      if (!mounted.current || request !== loadRequest.current) return;
      if (!result.success) throw new Error(result.error);
      // A newer broadcast takes precedence over an older get response.
      if (version === revision.current) {
        confirmed.current = result.data;
        setSettings(result.data);
      }
    } catch (error) {
      if (mounted.current && request === loadRequest.current) {
        setLoadError(`無法讀取設定：${errorMessage(error)}`);
      }
    } finally {
      if (mounted.current && request === loadRequest.current) setLoading(false);
    }
  }, [mounted]);

  useEffect(() => {
    const unsubscribe = window.api.settings.onChanged((next) => {
      revision.current++;
      confirmed.current = next;
      setSettings(next);
      setLoadError(null);
    });
    void reload();
    return () => {
      loadRequest.current++;
      unsubscribe();
    };
  }, [reload]);

  const update = useCallback(async (patch: AppSettingsPatch): Promise<boolean> => {
    const previous = confirmed.current;
    if (!mounted.current || !previous || busy.current) return false;
    busy.current = true;
    setSaving(true);
    report('儲存中…');
    setSettings({
      asr: { ...previous.asr, ...patch.asr },
      history: { ...previous.history, ...patch.history },
      input: { ...previous.input, ...patch.input },
    });
    const version = revision.current;
    try {
      const result = await window.api.settings.update(patch);
      if (!mounted.current) return false;
      if (!result.success) throw new Error(result.error);
      if (version === revision.current) {
        revision.current++;
        confirmed.current = result.data;
        setSettings(result.data);
      }
      report('已儲存');
      return true;
    } catch (error) {
      if (mounted.current) {
        setSettings(confirmed.current);
        report(`儲存失敗：${errorMessage(error)}`, true);
      }
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [mounted, report]);

  const value = useMemo(() => ({ settings, loading, loadError, saving, saveStatus, reload, update, report }),
    [settings, loading, loadError, saving, saveStatus, reload, update, report]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('找不到設定介面。');
  return context;
}
