// 분석: 기간 합계, 일별 집계, 블록 호출 순위, 신규 사용자 잔존율 (docs/builder-plan.md §6 B4, E12).
import { bot, request } from "./client";
import type { components } from "./schema";

type S = components["schemas"];

export type AnalyticsOut = S["AnalyticsOut"];
export type AnalyticsDayOut = S["AnalyticsDayOut"];
export type AnalyticsBlockOut = S["AnalyticsBlockOut"];
export type AnalyticsRetentionOut = S["AnalyticsRetentionOut"];
export type AnalyticsTotalsOut = S["AnalyticsTotalsOut"];

/** `from`/`to`: YYYY-MM-DD, 양끝 포함, 최대 92일(엔진의 제한). ApiError 422 날짜가 잘못됐거나 기간이
 * 너무 길 때, 409 봇이 삭제 대기 중일 때, 404 모르는 봇일 때. */
export async function getAnalytics(id: string, from: string, to: string): Promise<AnalyticsOut> {
  const res = await request(`${bot(id)}/analytics?from=${from}&to=${to}`);
  return (await res.json()) as AnalyticsOut;
}
