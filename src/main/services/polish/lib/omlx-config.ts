import path from 'node:path';
import { z } from 'zod';
import type { OmlxConfig, PolishConfigDependencies } from '../types';

const configSchema = z.object({
  server: z.object({ port: z.number().int().min(1).max(65535) }),
  auth: z.unknown().optional(),
});

/** Read on every use; only the port is trusted for local discovery. */
export async function readOmlxConfig(deps: PolishConfigDependencies): Promise<OmlxConfig | null> {
  try {
    const file = deps.env.OMLX_SETTINGS_PATH ?? path.join(deps.homedir(), '.omlx', 'settings.json');
    const parsed = configSchema.safeParse(JSON.parse(await deps.readFile(file)));
    if (parsed.success === false) {
      deps.logger.debug('oMLX config is invalid');
      return null;
    }
    const auth = z.object({ api_key: z.string() }).safeParse(parsed.data.auth);
    const key = auth.success === true ? auth.data.api_key : null;
    return {
      baseUrl: `http://127.0.0.1:${parsed.data.server.port}/v1`,
      apiKey: typeof key === 'string' && key.trim() ? key : null,
    };
  } catch {
    // Never log file contents, validation issues, or errors that could contain the key.
    deps.logger.debug('oMLX config is missing or invalid');
    return null;
  }
}
