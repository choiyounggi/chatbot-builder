// 분석 기간 계산: "오늘"은 항상 한국 시간(KST, UTC+9, DST 없음)이에요 — 브라우저의 시간대가 아니라.
// 엔진의 기간 제한(최대 92일, from ≤ to)을 요청 전에 먼저 확인해요(docs/builder-plan.md §6 B4, E12).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_DAYS = 92;

/** 오늘 날짜(YYYY-MM-DD), 한국 시간 기준. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `date`(YYYY-MM-DD)에서 `days`일 지난 날짜(음수면 이전 날짜), 시간대 없이 달력 계산만. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 두 YYYY-MM-DD 날짜 사이의 일수(양끝 포함). `to`가 `from`보다 이전이면 음수가 나와요. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export const PERIOD_PRESETS = [
  { id: "7", label: "최근 7일", days: 7 },
  { id: "30", label: "최근 30일", days: 30 },
] as const;
export type PresetId = (typeof PERIOD_PRESETS)[number]["id"];

/** 오늘(한국 시간)로 끝나는 `days`일짜리 기간. */
export function presetRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = kstToday(now);
  return { from: addDays(to, -(days - 1)), to };
}

/** The engine reads analytics only within these dates (chatcore api EARLIEST/LATEST). */
const EARLIEST = "2000-01-01", LATEST = "2100-12-31";

/** 직접 고른 기간을 엔진에 보낼 수 없는 이유, 보낼 수 있으면 null. 엔진에 요청하기 전에 먼저 확인해요:
 * 날짜가 모두 있어야 하고, 시작일이 종료일보다 늦으면 안 되고, 최대 92일까지예요. */
export function rangeProblem(from: string, to: string): string | null {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return "시작일과 종료일을 모두 입력해 주세요.";
  }
  if (from < EARLIEST || to > LATEST) return "2000년 1월 1일부터 2100년 12월 31일 사이의 날짜만 볼 수 있어요.";
  if (from > to) return "시작일은 종료일보다 늦을 수 없어요.";
  if (daysBetween(from, to) > MAX_DAYS) return `기간은 최대 ${MAX_DAYS}일까지예요.`;
  return null;
}

/** 0~1 사이 비율을 퍼센트 문자열로, null이면 "—". 0이 아닌 아주 작은 값을 0%로, 전부가 아닌 값을
 * 100%로 반올림하지 않아요("1% 미만", "99% 초과"). */
export function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
  if (rate > 0 && rate < 0.005) return "1% 미만";
  if (rate < 1 && rate >= 0.995) return "99% 초과";
  return `${Math.round(rate * 100)}%`;
}
