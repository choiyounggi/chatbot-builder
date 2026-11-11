// 지식베이스 (engine E-D, docs/builder-plan.md §6 B6): pure helpers over a knowledge-base draft.
// This draft is its own document with its own ETag, apart from the bot draft (src/draft/DraftContext).
import { newId } from "./doc";
import type { FaqEntry, KbDocument, KnowledgeDoc } from "../api/knowledge";

export const SUGGEST_TEXT_DEFAULT = "이런 답을 찾았어요. 골라 주세요.";

export type KbSettingsDoc = NonNullable<KnowledgeDoc["settings"]>;

/** The empty draft a bot starts from before anything is saved (engine defaults). */
export function emptyKb(): KnowledgeDoc {
  return { faq: [], documents: [], settings: { mode: "instant", suggest_text: SUGGEST_TEXT_DEFAULT } };
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
  return null;
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

export function writeSettings(kb: KnowledgeDoc, patch: Partial<KbSettingsDoc>): KnowledgeDoc {
  const settings = kb.settings ?? { mode: "instant", suggest_text: SUGGEST_TEXT_DEFAULT };
  return { ...kb, settings: { ...settings, ...patch } };
}

/** The first non-blank line of a document's text, for a list preview (never more than 80 characters). */
export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
