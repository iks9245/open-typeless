import type { SpeechReport } from '../../../../shared/types/report';

const numbers = new Intl.NumberFormat('zh-Hant', { maximumFractionDigits: 0 });
export function reportHeadline(report: Omit<SpeechReport, 'headline'>): string {
  if (report.dictations + report.commands === 0) return '這段期間還沒有聽寫紀錄。';
  const period = { week: '這週', month: '這個月', all: '總共' }[report.range];
  const filler = report.fillers.top[0];
  if (filler) return `你${period}說了 ${numbers.format(filler.spoken)} 次『${filler.term}』，AI 幫你刪掉了 ${numbers.format(filler.removed)} 次。`;
  return `你${period}聽寫了 ${numbers.format(report.characters)} 字，大約省下 ${numbers.format(Math.floor(report.savedMs / 60000))} 分鐘。`;
}
