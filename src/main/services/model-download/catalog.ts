import { z } from 'zod';
import { MODEL_CATALOG } from '../../../shared/constants/model-catalog';
import type { ModelCatalogEntry } from '../../../shared/types/model-download';

export const modelKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).max(100);
const entrySchema = z.object({
  key: modelKeySchema,
  fileName: z.string().regex(/^ggml-[a-zA-Z0-9._-]+\.bin$/),
  title: z.string(), description: z.string(), size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), url: z.string().url(), sourcePage: z.string().url(),
  license: z.string(), recommendedFor: z.enum(['cantonese', 'general', 'light']), credit: z.string().optional(),
});

export function validateCatalog(input: unknown, allowLoopback = false): ModelCatalogEntry[] {
  const entries = z.array(entrySchema).min(1).parse(input);
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const entry of entries) {
    const url = new URL(entry.url);
    const trusted = url.protocol === 'https:' && url.hostname === 'huggingface.co' && !url.port;
    const loopback = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if ((!trusted && !loopback) || url.username || url.password || url.search || url.hash || keys.has(entry.key) || names.has(entry.fileName)) {
      throw new Error('Invalid model catalog');
    }
    keys.add(entry.key);
    names.add(entry.fileName);
  }
  return entries;
}

/** Packaged apps never read the development override, even if the variable is set. */
export function loadModelCatalog(isPackaged: boolean, env: NodeJS.ProcessEnv, read: (file: string) => string): ModelCatalogEntry[] {
  if (!isPackaged && env.OPEN_TYPELESS_MODEL_CATALOG) {
    try { return validateCatalog(JSON.parse(read(env.OPEN_TYPELESS_MODEL_CATALOG)), true); }
    catch { throw new Error('Invalid development model catalog'); }
  }
  return validateCatalog(MODEL_CATALOG);
}
