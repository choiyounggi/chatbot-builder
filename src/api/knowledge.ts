// The knowledge base (지식베이스, engine E-D / builder plan §3): its own draft (ETag) apart from the
// bot draft, file → text, built versions, chunk preview and a search test. Deploying pairs a bot
// version with a knowledge-base version (api/deploy.ts).
import { ApiError, bot, request } from "./client";
import type { components } from "./schema";
import type { Job } from "./types";

type S = components["schemas"];
export type KnowledgeDoc = S["KnowledgeBase"];
export type FaqEntry = S["FaqEntry"];
export type KbDocument = S["KbDocument"];
export type KbSaved = S["KbSavedOut"];
export type KbVersions = S["KbVersionsOut"];
export type KbVersion = S["KbVersionOut"];
export type KbEntry = S["KbEntryOut"];
export type KbSearch = S["KbSearchOut"];
export type KbHit = S["KbHitOut"];

export interface KbDraft {
  document: KnowledgeDoc;
  etag: string;
}

/** The stored knowledge-base draft, or null when the bot has none yet (404). */
export async function getKbDraft(id: string): Promise<KbDraft | null> {
  try {
    const res = await request(`${bot(id)}/knowledge/draft`);
    const etag = res.headers.get("ETag");
    if (!etag) throw new ApiError(res.status, "the engine sent a knowledge base without an ETag");
    return { document: (await res.json()) as KnowledgeDoc, etag };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.message.includes("has no knowledge base")) return null;
    throw error;
  }
}

/** Save over the draft we read (`etag`), or create it (`etag` null). Saved even when invalid
 * (`valid`/`errors` say why). ConflictError (412) when it changed meanwhile; 428 when one exists
 * but no ETag was sent. Returns the new ETag with the result. */
export async function saveKbDraft(id: string, document: KnowledgeDoc, etag: string | null): Promise<{ saved: KbSaved; etag: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (etag) headers["If-Match"] = etag;
  const res = await request(`${bot(id)}/knowledge/draft`, { method: "PUT", headers, body: JSON.stringify(document) });
  return { saved: (await res.json()) as KbSaved, etag: res.headers.get("ETag") };
}

/** The text of a file to add as a document (PDF text layer, plain text or Markdown; at most 10 MB).
 * ApiError 422 with the engine's reason (empty, not UTF-8, no text, encrypted ...), 413 too large. */
export async function extractFile(id: string, file: Blob, type: string): Promise<string> {
  const res = await request(`${bot(id)}/knowledge/extract`, {
    method: "POST", headers: { "Content-Type": type || "application/octet-stream" }, body: file,
  });
  return ((await res.json()) as { text: string }).text;
}

/** The content type to send for a chosen file ("" when it cannot be used). */
export function fileType(file: { name: string; type: string }): string {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".md") || name.endsWith(".markdown") || file.type === "text/markdown") return "text/markdown";
  if (name.endsWith(".txt") || file.type === "text/plain") return "text/plain";
  return "";
}

/** Index the SAVED draft as a version (a job, kind "knowledge"; follow it with getJob).
 * Its result: {version, number, faq, chunks}; its error kinds: no_draft, invalid_draft. */
export async function startKbBuild(id: string): Promise<Job> {
  const res = await request(`${bot(id)}/knowledge/versions`, { method: "POST" });
  return (await res.json()) as Job;
}

export async function listKbVersions(id: string): Promise<KbVersions> {
  const res = await request(`${bot(id)}/knowledge/versions`);
  return (await res.json()) as KbVersions;
}

/** The FAQ entries and document chunks of a built version, as searched. 404 unknown version. */
export async function kbEntries(id: string, version: string): Promise<KbEntry[]> {
  const res = await request(`${bot(id)}/knowledge/versions/${encodeURIComponent(version)}/entries`);
  return ((await res.json()) as { entries: KbEntry[] }).entries;
}

/** Search a built version (default: the newest) as a conversation would. 409 nothing built yet. */
export async function searchKb(id: string, query: string, version?: string | null): Promise<KbSearch> {
  const res = await request(`${bot(id)}/knowledge/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(version ? { query, version } : { query }),
  });
  return (await res.json()) as KbSearch;
}

export interface KbBuildResult {
  version: string;
  number: number | null;
  faq: number | null;
  chunks: number | null;
}

/** The build job's result (an untyped engine dict), read defensively; null when it is not one. */
export function parseKbBuildResult(result: Record<string, unknown> | null | undefined): KbBuildResult | null {
  if (!result || typeof result.version !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return { version: result.version, number: num(result.number), faq: num(result.faq), chunks: num(result.chunks) };
}

/** The build job's failure in Korean. */
export function kbBuildError(error: Record<string, unknown> | null | undefined): { message: string; errors: string[] } {
  const errors = Array.isArray(error?.errors) ? error.errors.filter((e): e is string => typeof e === "string") : [];
  if (error?.kind === "no_draft") return { message: "저장된 지식베이스가 없어요. 먼저 저장해 주세요.", errors };
  if (error?.kind === "invalid_draft") return { message: "지식베이스에 고칠 곳이 있어 색인을 만들지 못했어요.", errors };
  return { message: "색인을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", errors };
}

export type LlmStatus = S["LlmOut"];
export type KbGenerated = S["KbGeneratedOut"];

/** Whether the engine has an LLM for generated answers and whether it answers now (a short test call). */
export async function llmStatus(): Promise<LlmStatus> {
  const res = await request("/v1/builder/llm");
  return (await res.json()) as LlmStatus;
}

/** What happened to a generation attempt, in Korean. */
export const GENERATION_OUTCOME: Record<KbGenerated["outcome"], string> = {
  generated: "생성한 답을 보여줘요",
  no_answer: "모델이 자료로 답할 수 없다고 해서 답하지 않아요",
  unsupported_number: "자료에 없는 숫자가 있어 버리고 답하지 않아요",
  too_long: "너무 길어 버리고 답하지 않아요",
  empty: "빈 답이라 버리고 답하지 않아요",
  timeout: "시간 안에 오지 않아 찾은 자료 원문으로 답해요",
  error: "LLM 서버 오류로 찾은 자료 원문으로 답해요",
};
