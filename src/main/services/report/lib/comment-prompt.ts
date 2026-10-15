import type { SpeechReport } from '../../../../shared/types/report';
import type { PolishMessage } from '../../polish/types';

export function buildCommentMessages(report: SpeechReport): PolishMessage[] {
  // Explicit allowlist: neither top words nor the headline can enter the prompt.
  const statistics = {
    dictations: report.dictations, commands: report.commands, characters: report.characters,
    speakingMs: report.speakingMs, charactersPerMinute: report.charactersPerMinute, savedMs: report.savedMs,
    corrections: report.corrections, peakHour: report.peakHour,
    fillers: report.fillers,
  };
  return [
    { role: 'system', content: '你是幽默但友善的說話教練。根據這份聽寫統計，用繁體中文寫 2–3 句輕鬆的點評和一個小建議。不要捏造數字。' },
    { role: 'user', content: JSON.stringify(statistics) },
  ];
}
