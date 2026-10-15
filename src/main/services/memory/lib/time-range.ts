export interface TimeRange { start: number; end: number }

/** Local calendar arithmetic preserves boundaries across DST. Weeks begin Monday. */
export function parseTimeRange(question: string, now: number): TimeRange | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).getTime();
  const range = (start: number, end: number): TimeRange => ({ start, end });
  if (/前天/.test(question)) return range(day(-2), day(-1));
  if (/昨天/.test(question)) return range(day(-1), day(0));
  if (/今天/.test(question)) return range(day(0), day(1));
  const weekday = (today.getDay() + 6) % 7;
  if (/上週|上禮拜/.test(question)) return range(day(-weekday - 7), day(-weekday));
  if (/這週|這禮拜|本週/.test(question)) return range(day(-weekday), day(7 - weekday));
  const month = (offset: number) => new Date(today.getFullYear(), today.getMonth() + offset, 1).getTime();
  if (/上個月/.test(question)) return range(month(-1), month(0));
  if (/這個月|本月/.test(question)) return range(month(0), month(1));
  const recent = question.match(/最近\s*(\d+)\s*天/);
  if (recent && Number(recent[1]) > 0 && Number(recent[1]) <= 36500) return range(day(1 - Number(recent[1])), day(1));
  const date = question.match(/(\d{1,2})月(\d{1,2})[日號]/);
  if (date) {
    const m = Number(date[1]), d = Number(date[2]);
    const start = new Date(today.getFullYear(), m - 1, d);
    if (start.getMonth() === m - 1 && start.getDate() === d) {
      return range(start.getTime(), new Date(today.getFullYear(), m - 1, d + 1).getTime());
    }
  }
  return null;
}
