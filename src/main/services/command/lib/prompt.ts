import type { PolishMessage } from '../../polish/types';

export const EDIT_SYSTEM_PROMPT = '你是文字編輯工具。依照使用者的口述指令，修改 <selection> 內的文字。只輸出修改後的完整文字，不要加上說明、標籤或引號。指令沒有指定語言時，維持原文的語言；中文使用繁體中文。';
export const GENERATE_SYSTEM_PROMPT = '你是寫作助手。依照使用者的口述指令，產生要插入文件游標處的文字。只輸出要插入的文字本身，不要加上前言、說明、標籤或引號。中文使用繁體中文。';

export function buildCommandMessages(instruction: string, selection: string | null): PolishMessage[] {
  const clean = (text: string): string => text.replace(/<\/?(?:instruction|selection)\b[^>]*>/gi, '');
  return [
    { role: 'system', content: selection === null ? GENERATE_SYSTEM_PROMPT : EDIT_SYSTEM_PROMPT },
    { role: 'user', content: `<instruction>${clean(instruction)}</instruction>`
      + (selection === null ? '' : `\n<selection>${clean(selection)}</selection>`) },
  ];
}

export function commandBudget(selection: string | null): { maxTokens: number; timeoutMs: number } {
  const maxTokens = selection === null ? 1024 : Math.min(4096, Array.from(selection).length * 3 + 256);
  return { maxTokens, timeoutMs: Math.min(90000, 15000 + 40 * maxTokens) };
}
