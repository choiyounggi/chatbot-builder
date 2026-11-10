// 머신러닝 settings (engine E13): the similarity level, exact-only intents, keyword match.
// Setting a value back to its default removes the key, so documents that never used it stay as they were.
import type { BotDoc } from "./doc";

export const LEVELS = [
  { id: "low", label: "낮음", target: 0.8 },
  { id: "normal", label: "보통", target: 0.9 },
  { id: "somewhat_high", label: "다소 높음", target: 0.95 },
  { id: "high", label: "높음", target: 0.97 },
  { id: "very_high", label: "매우 높음", target: 0.99 },
] as const;
export type Level = (typeof LEVELS)[number]["id"];

export const levelOf = (doc: BotDoc): Level | null => {
  const level = doc.settings?.similarity_level;
  return LEVELS.some((l) => l.id === level) ? (level as Level) : null;
};

function withSetting(doc: BotDoc, key: string, value: unknown): BotDoc {
  const next = structuredClone(doc);
  const settings: Record<string, unknown> = { ...next.settings };
  if (value === null || value === false) delete settings[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
  else settings[key] = value;
  if (Object.keys(settings).length > 0) next.settings = settings;
  else delete next.settings; // nothing left: as if it was never set
  return next;
}

export const setLevel = (doc: BotDoc, level: Level | null): BotDoc => withSetting(doc, "similarity_level", level);
export const setKeywordMatch = (doc: BotDoc, on: boolean): BotDoc => withSetting(doc, "keyword_match", on);

export function setExactOnly(doc: BotDoc, intent: string, on: boolean): BotDoc {
  const spec = doc.intents?.[intent];
  if (!spec) throw new Error(`no intent ${intent}`);
  const next = structuredClone(doc);
  const updated = { ...spec };
  if (on) updated.exact_only = true;
  else delete updated.exact_only;
  next.intents = { ...next.intents, [intent]: updated };
  return next;
}

/** Intents left for the classifier (the engine needs at least two to train). */
export const classifierIntents = (doc: BotDoc): string[] =>
  Object.entries(doc.intents ?? {}).filter(([, spec]) => !spec.exact_only).map(([id]) => id);
