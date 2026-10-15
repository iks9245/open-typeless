export type PolishUnavailableReason = 'not-installed' | 'unreachable' | 'unauthorized';

export interface PolishInfo {
  available: boolean;
  reason: PolishUnavailableReason | null;
  models: string[];
}
