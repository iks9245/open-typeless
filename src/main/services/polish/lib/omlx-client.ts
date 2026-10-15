import { z } from 'zod';
import type { OmlxConfig, PolishMessage } from '../types';

export class OmlxHttpError extends Error {
  constructor(readonly status: number) {
    super(`oMLX responded with HTTP ${status}`);
    this.name = 'OmlxHttpError';
  }
}

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function headers(config: OmlxConfig): Record<string, string> {
  return config.apiKey === null ? {} : { Authorization: `Bearer ${config.apiKey}` };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new OmlxHttpError(response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Invalid oMLX JSON response');
  }
}

export async function listModels(config: OmlxConfig, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${config.baseUrl}/models`, { headers: headers(config), signal, redirect: 'error' });
  const parsed = modelsSchema.safeParse(await responseJson(response));
  if (parsed.success === false) throw new Error('Invalid oMLX models response');
  return parsed.data.data.map(model => model.id);
}

export async function createCompletion(
  config: OmlxConfig,
  options: { model: string; messages: PolishMessage[]; maxTokens: number },
  fetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model, messages: options.messages, temperature: 0, max_tokens: options.maxTokens,
      stream: false, chat_template_kwargs: { enable_thinking: false },
    }),
    signal,
    redirect: 'error',
  });
  const parsed = completionSchema.safeParse(await responseJson(response));
  if (parsed.success === false) throw new Error('Invalid oMLX completion response');
  return parsed.data.choices[0].message.content;
}
