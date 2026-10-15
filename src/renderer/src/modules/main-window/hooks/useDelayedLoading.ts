import { useEffect, useState } from 'react';

/** Fast IPC loads never flash a loading message. Background loads keep content. */
export function useDelayedLoading(pending: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return pending && visible;
}
