import type { PolishDependencies } from '../types';
import { readOmlxConfig } from './omlx-config';
import { createCompletion } from './omlx-client';
import { buildPolishMessages } from './prompt';
import { withOmlxTimeout } from './timeout';

export function warmOmlx(
  deps: Pick<PolishDependencies, 'readFile' | 'env' | 'homedir' | 'logger' | 'fetch' | 'now' | 'timers'>,
  model: string, warming: Set<string>, warmedAt: Map<string, number>,
): void {
  const warmed = warmedAt.get(model);
  if (warming.has(model) || (warmed !== undefined && deps.now() - warmed < 60000)) return;
  warming.add(model);
  void withOmlxTimeout(deps.timers, 30000, async (signal) => {
    const config = await readOmlxConfig(deps);
    if (!config) throw new Error('oMLX not installed');
    await createCompletion(config, { model, messages: buildPolishMessages('測試', []), maxTokens: 1 }, deps.fetch, signal);
    warmedAt.set(model, deps.now());
  }).catch(() => {
    deps.logger.debug('oMLX warm-up failed');
  }).finally(() => {
    warming.delete(model);
  });
}
