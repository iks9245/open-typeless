export interface AskSource {
  n: number;
  transcriptionId: string;
  createdAt: number;
  snippet: string;
  cited: boolean;
}
export interface AskResult { answer: string; sources: AskSource[] }
export interface AskEntry extends AskResult { id: string; question: string; createdAt: number }
export interface MemoryStatus {
  enabled: boolean;
  state: 'idle' | 'indexing' | 'paused' | 'disabled';
  indexed: number;
  total: number;
  reason: string | null;
}
