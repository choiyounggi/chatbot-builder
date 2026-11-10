// The bot's system blocks (docs/builder-plan.md §2.5): welcome, fallback, escape, and the
// conversation settings (re-ask limit, idle timeout). Every function returns a new document.
import { newBlockId, responseRefs, textReply, writeBlock } from "./blocks";
import { type BotDoc, newId, type SystemDoc, without } from "./doc";

export const DEFAULT_MAX_ATTEMPTS = 3; // chatcore Settings.max_attempts
export const TIMEOUT_NOTICE = "timeout_notice"; // the response the idle-timeout notice is written to

/** The document with `system` changed; an emptied `system` is removed again so old documents stay as they were. */
function withSystem(doc: BotDoc, change: (system: SystemDoc) => SystemDoc): BotDoc {
  const next = structuredClone(doc);
  const system = change({ ...next.system });
  const kept = Object.fromEntries(Object.entries(system).filter(([, v]) => v !== null && v !== undefined));
  if (Object.keys(kept).length > 0) next.system = kept;
  else delete next.system;
  return next;
}

export function setWelcome(doc: BotDoc, scenario: string | null): BotDoc {
  if (scenario !== null && !doc.scenarios[scenario]) throw new Error(`no scenario ${scenario}`);
  return withSystem(doc, (s) => ({ ...s, welcome: scenario }));
}

/** Turn the welcome block on with a new block (one text reply), started only by opening a conversation. */
export function createWelcome(doc: BotDoc, text: string): { doc: BotDoc; id: string } {
  const id = newBlockId(doc);
  const response = newId(`${id}_reply`, Object.keys(doc.responses));
  const next = writeBlock(doc, {
    id, label: "웰컴", group: "", intent: null, examples: [], params: [],
    replies: [textReply(response, text.trim())], steps: [{ respond: response }],
  });
  return { doc: setWelcome(next, id), id };
}

/** Escape phrases (blank ones dropped, duplicates kept once) and the block run afterwards. No phrases: escape off. */
export function setEscape(doc: BotDoc, phrases: string[], scenario: string | null): BotDoc {
  if (scenario !== null && !doc.scenarios[scenario]) throw new Error(`no scenario ${scenario}`);
  const clean = [...new Set(phrases.map((p) => p.trim()).filter(Boolean))];
  return withSystem(doc, (s) => ({ ...s, escape: clean.length ? { phrases: clean, ...(scenario ? { scenario } : {}) } : null }));
}

/** Idle timeout in minutes (null: off) and the notice said when a conversation in progress is dropped
 * (blank: the engine's "restarted" response). The notice is a plain text response (no variables). */
export function setTimeoutRule(doc: BotDoc, minutes: number | null, notice: string): BotDoc {
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
    throw new RangeError("minutes must be a whole number from 1 to 1440");
  }
  const text = notice.trim();
  const old = doc.system?.timeout?.notice ?? null;
  const responseId = old ?? (doc.responses[TIMEOUT_NOTICE] ? newId(TIMEOUT_NOTICE, Object.keys(doc.responses)) : TIMEOUT_NOTICE);
  let next = withSystem(doc, (s) => ({
    ...s, timeout: minutes === null ? null : { minutes, ...(text ? { notice: responseId } : {}) },
  }));
  if (minutes !== null && text) next.responses = { ...next.responses, [responseId]: { text } };
  if (old && !responseRefs(next).has(old)) next = { ...next, responses: without(next.responses, old) };
  return next;
}

/** Failed re-asks of one parameter before the bot gives up (1-10). */
export function setMaxAttempts(doc: BotDoc, attempts: number): BotDoc {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new RangeError("attempts must be 1-10");
  const next = structuredClone(doc);
  next.settings = { ...next.settings, max_attempts: attempts };
  return next;
}

export interface SystemView {
  welcome: string | null;
  escapePhrases: string[];
  escapeScenario: string | null;
  timeoutMinutes: number | null;
  timeoutNotice: string; // the notice text ("" = the engine's restarted response)
  maxAttempts: number;
}

export function readSystem(doc: BotDoc): SystemView {
  const notice = doc.system?.timeout?.notice;
  const noticeText = notice ? doc.responses[notice]?.text ?? "" : "";
  return {
    welcome: doc.system?.welcome ?? null,
    escapePhrases: [...(doc.system?.escape?.phrases ?? [])],
    escapeScenario: doc.system?.escape?.scenario ?? null,
    timeoutMinutes: doc.system?.timeout?.minutes ?? null,
    timeoutNotice: noticeText ?? "",
    maxAttempts: typeof doc.settings?.max_attempts === "number" ? doc.settings.max_attempts : DEFAULT_MAX_ATTEMPTS,
  };
}
