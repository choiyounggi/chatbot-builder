import type { components } from "../api/schema";

type S = components["schemas"];

// The bot document as stored. The generated schema marks fields that have defaults
// (label, exclusive, quick_replies, ...) as required; a stored document may omit them,
// so these local types make them optional. Unknown keys are kept as they are.
export type Step = S["CollectStep"] | S["ActionStep"] | S["RespondStep"] | S["CallStep"] | S["BranchStep"];

export interface SlotDoc {
  entity: string;
  ask: string;
}

export interface ScenarioDoc {
  label?: string;
  trigger?: { intent: string } | null;
  exclusive?: boolean;
  slots?: Record<string, SlotDoc>;
  steps: Step[];
  on_error?: string | null;
  [key: string]: unknown;
}

export interface ResponseDoc {
  text?: string | null;
  variants?: string[] | null;
  quick_replies?: string[];
}

export interface IntentDoc {
  label?: string;
  examples: string[];
}

export interface DictionaryEntityDoc {
  kind: "dictionary";
  label?: string;
  values: Record<string, string[]>;
}

export interface RegexEntityDoc {
  kind: "regex";
  label?: string;
  pattern: string;
}

export type EntityDoc = DictionaryEntityDoc | RegexEntityDoc;

export interface BotDoc {
  id: string;
  label?: string;
  intents?: Record<string, IntentDoc>;
  entities?: Record<string, EntityDoc>;
  scenarios: Record<string, ScenarioDoc>;
  responses: Record<string, ResponseDoc>;
  [key: string]: unknown;
}

/** Responses the engine itself needs (chatcore bot/schema.py REQUIRED_RESPONSES). */
export const REQUIRED_RESPONSES = ["fallback", "cancelled", "restarted", "error", "clarify", "input_invalid"] as const;

/** The engine's system entities (chatcore bot/schema.py SYSTEM_ENTITIES). */
export const SYSTEM_ENTITIES = [
  { id: "sys.number", label: "숫자", examples: "3, 셋, 열두 개" },
  { id: "sys.date", label: "날짜", examples: "내일, 다음 주 월요일, 3월 5일" },
  { id: "sys.time", label: "시각", examples: "오후 3시, 3시 반, 15:30" },
] as const;

/** An id matching the engine's ID pattern (^[a-z][a-z0-9_]*$) that is not in `taken`. */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!used.has(id)) return id;
  }
}

/** The record without these keys (a new object). */
export function without<T>(record: Record<string, T>, ...keys: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

export function responseTexts(response: ResponseDoc | undefined): string[] {
  if (!response) return [""];
  if (response.variants != null) return [...response.variants];
  return [response.text ?? ""];
}

/** Write texts back in the response's own shape: `text` stays `text` unless there are now several. */
export function withTexts(response: ResponseDoc | undefined, texts: string[], quickReplies: string[]): ResponseDoc {
  const next: ResponseDoc = { ...response };
  if (response?.variants != null || texts.length > 1) {
    next.variants = texts;
    delete next.text;
  } else {
    next.text = texts[0] ?? "";
    delete next.variants;
  }
  if (quickReplies.length > 0 || response?.quick_replies !== undefined) next.quick_replies = quickReplies;
  return next;
}
