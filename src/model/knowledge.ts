// 지식베이스 (engine E-D, docs/builder-plan.md §6 B6): pure helpers over a knowledge-base draft.
// This draft is its own document with its own ETag, apart from the bot draft (src/draft/DraftContext).
import { newId } from "./doc";
import type { FaqEntry, KbDocument, KnowledgeDoc } from "../api/knowledge";

export const SUGGEST_TEXT_DEFAULT = "이런 답을 찾았어요. 골라 주세요.";

export type KbSettingsDoc = NonNullable<KnowledgeDoc["settings"]>;
/** Settings as stored: keys left at the engine's default may be absent (`generate` is removed when off). */
type StoredSettings = Omit<KbSettingsDoc, "generate"> & { generate?: boolean };
const DEFAULT_SETTINGS: StoredSettings = { mode: "instant", suggest_text: SUGGEST_TEXT_DEFAULT };

/** The empty draft a bot starts from before anything is saved (engine defaults). */
export function emptyKb(): KnowledgeDoc {
  return { faq: [], documents: [], settings: { ...DEFAULT_SETTINGS } as KbSettingsDoc };
}

/** Deep-equal regardless of key order (a round trip through the engine can reorder keys). */
export function sameKb(a: KnowledgeDoc | null, b: KnowledgeDoc | null): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** A new FAQ entry with an id from `newId` (smallest unused `faq_<n>`), appended empty. */
export function addFaq(kb: KnowledgeDoc): { kb: KnowledgeDoc; id: string } {
  const faq = kb.faq ?? [];
  const id = newId("faq", faq.map((f) => f.id));
  return { kb: { ...kb, faq: [...faq, { id, question: "", answer: "" }] }, id };
}

export function removeFaq(kb: KnowledgeDoc, id: string): KnowledgeDoc {
  return { ...kb, faq: (kb.faq ?? []).filter((f) => f.id !== id) };
}

export function writeFaq(kb: KnowledgeDoc, id: string, patch: Partial<FaqEntry>): KnowledgeDoc {
  return { ...kb, faq: (kb.faq ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

/** FAQ ids whose question is the same as another's after trimming (both members of each pair). */
export function duplicateFaqIds(kb: KnowledgeDoc): Set<string> {
  const counts = new Map<string, number>();
  for (const f of kb.faq ?? []) {
    const key = f.question.trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const f of kb.faq ?? []) {
    const key = f.question.trim();
    if (key && (counts.get(key) ?? 0) > 1) ids.add(f.id);
  }
  return ids;
}

/** Why an FAQ row needs attention before it is useful (still savable: the engine reports the rest). */
export function faqWarning(f: FaqEntry, duplicates: Set<string>): string | null {
  if (duplicates.has(f.id)) return "같은 질문이 이미 있어요";
  if (!f.question.trim()) return "질문을 입력해 주세요";
  if (!f.answer.trim()) return "답을 입력해 주세요";
  const keys = [f.question, ...(f.similar ?? [])].map(bare);
  if (new Set(keys).size !== keys.length) return "비슷한 질문이 질문이나 다른 비슷한 질문과 같아요";
  return null;
}

const PUNCT_EDGES = /^[\s.,!?~…·'"()[\]]+|[\s.,!?~…·'"()[\]]+$/g;

/** The engine's sameness rule for questions (chatcore/nlu/entities.py `bare`): NFKC, spaces collapsed,
 * punctuation at the ends dropped. Case is kept. */
export function bare(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().replace(PUNCT_EDGES, "");
}

/** `texts` added to an FAQ's similar questions: each trimmed, skipped when blank, the same as the question
 * or one already there (by `bare`), or past LIMITS.similar. */
export function withSimilar(f: FaqEntry, texts: string[]): { similar: string[]; added: number; skipped: number } {
  const similar = [...(f.similar ?? [])];
  const seen = new Set([f.question, ...similar].map(bare));
  let added = 0;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text || seen.has(bare(text)) || similar.length >= LIMITS.similar) continue;
    seen.add(bare(text));
    similar.push(text);
    added += 1;
  }
  return { similar, added, skipped: texts.length - added };
}

/** An FAQ's similar questions set; none left removes the key (an untouched FAQ stays the same document). */
export function writeSimilar(kb: KnowledgeDoc, id: string, similar: string[]): KnowledgeDoc {
  return { ...kb, faq: (kb.faq ?? []).map((f) => {
    if (f.id !== id) return f;
    if (similar.length > 0) return { ...f, similar };
    const rest = { ...f };
    delete rest.similar;
    return rest;
  }) };
}

/** A new document with an id from `newId` (smallest unused `doc_<n>`). */
export function addDocument(kb: KnowledgeDoc, name: string, text: string): { kb: KnowledgeDoc; id: string } {
  const documents = kb.documents ?? [];
  const id = newId("doc", documents.map((d) => d.id));
  return { kb: { ...kb, documents: [...documents, { id, name, text }] }, id };
}

export function removeDocument(kb: KnowledgeDoc, id: string): KnowledgeDoc {
  return { ...kb, documents: (kb.documents ?? []).filter((d) => d.id !== id) };
}

export function writeDocument(kb: KnowledgeDoc, id: string, patch: Partial<KbDocument>): KnowledgeDoc {
  return { ...kb, documents: (kb.documents ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

/** Change settings; turning `generate` off removes the key (the engine's default), so switching it on and
 * off again leaves the draft exactly as it was. */
export function writeSettings(kb: KnowledgeDoc, patch: Partial<KbSettingsDoc>): KnowledgeDoc {
  const settings: StoredSettings = { ...(kb.settings ?? DEFAULT_SETTINGS), ...patch };
  if (settings.generate === false) delete settings.generate;
  return { ...kb, settings: settings as KbSettingsDoc };
}

/** The first non-blank line of a document's text, for a list preview (never more than 80 characters). */
export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** The engine's limits (chatcore/knowledge.py), so inputs stop where the engine would refuse. */
export const LIMITS = { question: 300, answer: 2000, name: 200, text: 200_000, upload: 10 * 1024 * 1024, similar: 50 } as const;

/** A document the engine cannot index as it is ("" name or text), or null. */
export function documentWarning(d: KbDocument): string | null {
  if (!d.name.trim()) return "이름이 비어 있으면 색인을 만들 수 없어요.";
  if (!d.text.trim()) return "본문이 비어 있으면 색인을 만들 수 없어요.";
  return null;
}

const UPLOAD_REASONS: [RegExp, string][] = [
  [/not UTF-8/, "UTF-8 글이 아니에요. 메모장 등에서 UTF-8로 다시 저장해 올려 주세요(EUC-KR 파일 등)."],
  [/unsupported file type/, "PDF, 텍스트(.txt), 마크다운(.md)만 올릴 수 있어요."],
  [/no text found/, "글자를 찾지 못했어요. 스캔한 PDF는 글자가 없어서 쓸 수 없어요."],
  [/encrypted/, "암호가 걸린 PDF는 읽을 수 없어요."],
  [/not a readable PDF/, "PDF를 읽지 못했어요. 파일이 손상되었을 수 있어요."],
  [/pages/, "500쪽이 넘는 PDF는 올릴 수 없어요."],
  [/characters; one document holds at most/, "글이 너무 길어요. 한 문서는 20만 자까지예요."],
  [/the file is empty/, "빈 파일이에요."],
  [/over \d+ MB/, "10MB가 넘는 파일은 올릴 수 없어요."],
];

/** Why the engine could not read an uploaded file, in Korean (its own reason when unknown). */
export function uploadReason(reason: string): string {
  return UPLOAD_REASONS.find(([pattern]) => pattern.test(reason))?.[1] ?? reason;
}

const FIELD: Record<string, string> = { question: "질문", answer: "답", id: "id", name: "이름", text: "본문" };

/** An engine save problem ("faq.0.question: String should have at most 300 characters") with its
 * place named as on screen ("FAQ 1 질문: …"). */
export function kbProblem(problem: string): string {
  const m = /^(faq|documents)\.(\d+)\.(\w+): (.*)$/s.exec(problem);
  if (m) return `${m[1] === "faq" ? "FAQ" : "문서"} ${Number(m[2]) + 1} ${FIELD[m[3] as string] ?? m[3]}: ${m[4]}`;
  if (problem.startsWith("settings.suggest_text:")) return problem.replace("settings.suggest_text:", "안내 문구:");
  if (problem.startsWith("settings.mode:")) return problem.replace("settings.mode:", "응답 방식:");
  return problem;
}
