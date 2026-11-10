// Deploy menu (versions, deploy, rollback) and 작업이력 (edits) — docs/builder-plan.md §6 B4.
import { bot, request } from "./client";
import type { components } from "./schema";
import type { Job } from "./types";

type S = components["schemas"];

export type VersionsOut = S["VersionsOut"];
export type VersionOut = S["VersionOut"];
export type DeploymentOut = S["DeploymentOut"];
export type LiveOut = S["LiveOut"];
export type EditsOut = S["EditsOut"];
export type EditOut = S["EditOut"];
export type ChangeOut = S["ChangeOut"];

export async function listVersions(id: string): Promise<VersionsOut> {
  const res = await request(`${bot(id)}/versions`);
  return (await res.json()) as VersionsOut;
}

/** Start training the SAVED draft as a deployable version (a job; follow it with getJob). */
export async function startVersionJob(id: string): Promise<Job> {
  const res = await request(`${bot(id)}/versions`, { method: "POST" });
  return (await res.json()) as Job;
}

/** ApiError 404 unknown version, 409 not trained / cannot run here. */
export async function deployVersion(id: string, version: string, note: string): Promise<LiveOut> {
  const res = await request(`${bot(id)}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, note }),
  });
  return (await res.json()) as LiveOut;
}

/** ApiError 409 when there is no earlier deployment. */
export async function rollbackVersion(id: string): Promise<LiveOut> {
  const res = await request(`${bot(id)}/rollback`, { method: "POST" });
  return (await res.json()) as LiveOut;
}

export async function listEdits(id: string, limit: number): Promise<EditsOut> {
  const res = await request(`${bot(id)}/edits?limit=${limit}`);
  return (await res.json()) as EditsOut;
}

/** A timestamp from the engine (ISO 8601), shown local and readable. Falls back to the raw
 * string for a value that does not parse (should not happen, but never crash on it). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

// ---- the version job's result/error: untyped engine dicts (JobOut.result/.error), read defensively ----

export interface VersionThresholds {
  intentThreshold: number | null;
  similarityThreshold: number | null;
  ambiguityMargin: number | null;
  /** 낮음/보통/다소 높음/높음/매우 높음, or "직접 설정" when the level is missing or not one of the five steps
   * (docs/builder-plan.md §4.4). Assumption: the engine names the five steps "low"/"medium"/"somewhat_high"/
   * "high"/"very_high" — unconfirmed; everything else (including a bot with no out_of_scope examples) falls
   * back to "직접 설정". */
  levelLabel: string;
}

export interface ConfusablePair {
  label: string;
  score: number | null;
}

export interface VersionJobResult {
  macroF1: number | null;
  clarifyRate: number | null;
  /** intent id -> F1 */
  perIntentF1: Record<string, number> | null;
  warnings: string[];
  thresholds: VersionThresholds | null;
  confusable: ConfusablePair[];
}

export type VersionJobError =
  | { kind: "invalid_draft"; errors: string[] }
  | { kind: "below_bar"; detail: string; perIntentF1: Record<string, number> | null }
  | { kind: "training"; detail: string }
  | { kind: "no_draft" }
  | { kind: "unknown"; detail: string | null };

const LEVEL_LABELS: Record<string, string> = {
  low: "낮음", medium: "보통", somewhat_high: "다소 높음", high: "높음", very_high: "매우 높음",
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asPerIntentF1(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function asThresholds(value: unknown): VersionThresholds | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const level = typeof o.level === "string" ? o.level : null;
  return {
    intentThreshold: typeof o.intent_threshold === "number" ? o.intent_threshold : null,
    similarityThreshold: typeof o.similarity_threshold === "number" ? o.similarity_threshold : null,
    ambiguityMargin: typeof o.ambiguity_margin === "number" ? o.ambiguity_margin : null,
    levelLabel: (level && LEVEL_LABELS[level]) || "직접 설정",
  };
}

/** Assumption: a confusable pair is `{a, b, score}` (intent ids + a similarity score). A pair in a
 * shape we don't recognize is skipped rather than guessed at. */
function asConfusablePairs(value: unknown): ConfusablePair[] {
  if (!Array.isArray(value)) return [];
  const pairs: ConfusablePair[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.a === "string" && typeof o.b === "string") {
      pairs.push({ label: `${o.a} ↔ ${o.b}`, score: typeof o.score === "number" ? o.score : null });
    }
  }
  return pairs;
}

export function parseVersionJobResult(result: Record<string, unknown> | null): VersionJobResult {
  const r = result ?? {};
  return {
    macroF1: typeof r.macro_f1 === "number" ? r.macro_f1 : null,
    clarifyRate: typeof r.clarify_rate === "number" ? r.clarify_rate : null,
    perIntentF1: asPerIntentF1(r.per_intent_f1),
    warnings: asStringArray(r.warnings),
    thresholds: asThresholds(r.thresholds),
    confusable: asConfusablePairs(r.confusable),
  };
}

export function parseVersionJobError(error: Record<string, unknown> | null): VersionJobError {
  if (error === null) return { kind: "unknown", detail: null };
  const kind = typeof error.kind === "string" ? error.kind : null;
  if (kind === "invalid_draft") return { kind, errors: asStringArray(error.errors) };
  if (kind === "below_bar") {
    return {
      kind,
      detail: typeof error.detail === "string" ? error.detail : "기준에 미달했어요",
      perIntentF1: asPerIntentF1(error.per_intent_f1),
    };
  }
  if (kind === "training") return { kind, detail: typeof error.detail === "string" ? error.detail : "학습하지 못했어요" };
  if (kind === "no_draft") return { kind };
  return { kind: "unknown", detail: typeof error.detail === "string" ? error.detail : null };
}
