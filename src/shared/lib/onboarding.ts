import { DEFAULT_COMMAND_MODEL } from '../constants/command';
import { DEFAULT_POLISH_MODEL } from '../constants/polish';
import type { TranscriptionItem } from '../types/history';
import type { PrimaryLanguage } from '../types/settings';

/** Recommendations are independent of the OS and catalog installation state. */
export function onboardingRecommendations(language: PrimaryLanguage | null, totalMemoryGb: number | null) {
  return {
    catalogKey: language === 'yue' ? 'large-v3-cantonese-q8_0' : 'large-v3-turbo',
    lighterCatalogKey: totalMemoryGb !== null && totalMemoryGb < 8 ? 'large-v3-turbo-q5_0' : null,
    asrLanguage: null,
    polishStyle: 'standard' as const,
    polishModel: DEFAULT_POLISH_MODEL,
    commandModel: totalMemoryGb !== null && totalMemoryGb >= 32 ? DEFAULT_COMMAND_MODEL : DEFAULT_POLISH_MODEL,
    commandsLessReliable: totalMemoryGb === null || totalMemoryGb < 32,
  };
}

/** Only a recent completed dictation can satisfy the wizard's trial. */
export function isRecentOnboardingTrial(
  item: Pick<TranscriptionItem, 'status' | 'updatedAt' | 'finalText'> | undefined,
  now: number = Date.now(),
): boolean {
  if (!item || item.status !== 'completed' || !item.finalText?.trim()) return false;
  const age = now - item.updatedAt;
  return age >= 0 && age <= 60000;
}
