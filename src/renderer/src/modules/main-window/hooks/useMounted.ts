import { useEffect, useRef } from 'react';

/** IPC promises cannot be aborted; ignore their results after unmount. */
export function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}
