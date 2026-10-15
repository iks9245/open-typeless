import type { PolishDependencies } from '../types';

export async function withOmlxTimeout<T>(
  timers: PolishDependencies['timers'], ms: number, run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = timers.setTimeout(() => {
      reject(new Error('oMLX request timed out'));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) timers.clearTimeout(timer);
  }
}
