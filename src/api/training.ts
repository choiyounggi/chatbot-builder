// The engine's training queue (학습대기) and what was done with it (학습이력), builder plan E6.
import { bot, request } from "./client";
import type { components } from "./schema";

type S = components["schemas"];
export type Utterances = S["UtterancesOut"];
export type Utterance = S["UtteranceOut"];
export type Mark = S["MarkOut"];

export interface QueueFilter {
  since?: string | null; // ISO 8601 with a time zone
  rule: "misunderstood" | "all";
  intent?: string | null;
  status: "pending" | "ignored" | "added" | "all";
  limit?: number;
}

export async function listUtterances(id: string, filter: QueueFilter): Promise<Utterances> {
  const params = new URLSearchParams({ rule: filter.rule, status: filter.status, limit: String(filter.limit ?? 100) });
  if (filter.since) params.set("since", filter.since);
  if (filter.intent) params.set("intent", filter.intent);
  const res = await request(`${bot(id)}/utterances?${params.toString()}`);
  return (await res.json()) as Utterances;
}

const post = (id: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(`${bot(id)}/utterances/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });

export async function ignoreUtterances(id: string, texts: string[]): Promise<void> {
  await post(id, "ignore", { texts });
}

export async function restoreUtterances(id: string, texts: string[]): Promise<void> {
  await post(id, "restore", { texts });
}

/** Add sentences to an intent of the stored draft as examples (like a save: needs its ETag;
 * ConflictError when it moved on). Returns the draft's new ETag. */
export async function addUtterances(id: string, texts: string[], intent: string, etag: string): Promise<string | null> {
  const res = await post(id, "add", { texts, intent }, { "If-Match": etag });
  return res.headers.get("ETag");
}

export async function listMarks(id: string, limit = 100): Promise<Mark[]> {
  const res = await request(`${bot(id)}/utterances/marks?limit=${limit}`);
  return ((await res.json()) as { items: Mark[] }).items;
}
