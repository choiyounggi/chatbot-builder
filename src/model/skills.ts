// HTTP skills (engine E10, docs/builder-plan.md B5): pure helpers over the draft's `skills` map.
// A skill is an action a scenario step or a slot's validation calls by its id; deleting one still in
// use is refused (readBlock/paramUses do the same for blocks and parameters).
import { type BotDoc, newId, SKILL_TIMEOUT, type SkillDoc, without } from "./doc";

export const SKILL_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const BUILTIN_ACTIONS = ["get_weather", "get_temperature", "now"] as const;

/** Every `{{ secret.NAME }}` in a header value (the only template the engine allows there). */
const SECRET_TEMPLATE = /\{\{\s*secret\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

const isAscii = (s: string) => [...s].every((c) => c.charCodeAt(0) <= 127);

export interface SkillRow {
  id: string;
  label: string; // label, or id when it has none
  host: string; // the URL's host, or "" when the URL cannot be parsed
  usedBy: number;
}

/** Every skill of the draft, for the list screen. */
export function listSkills(doc: BotDoc): SkillRow[] {
  return Object.entries(doc.skills ?? {}).map(([id, skill]) => ({
    id, label: skill.label || id, host: hostOf(skill.url), usedBy: skillUsedBy(doc, id).length,
  }));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** The blocks that call or validate with this skill, one per block: "label(id)". */
export function skillUsedBy(doc: BotDoc, id: string): string[] {
  return Object.entries(doc.scenarios)
    .filter(([, scenario]) => scenario.steps.some((step) => "action" in step && step.action === id)
      || Object.values(scenario.slots ?? {}).some((slot) => slot.validation?.action === id))
    .map(([sid, scenario]) => `${scenario.label || "(이름 없음)"}(${sid})`);
}

/** A new skill with an id from `newId`, an empty URL and the default timeout. */
export function addSkill(doc: BotDoc): { doc: BotDoc; id: string } {
  const id = newId("skill", Object.keys(doc.skills ?? {}));
  return { doc: { ...doc, skills: { ...doc.skills, [id]: { url: "", timeout_ms: SKILL_TIMEOUT.default } } }, id };
}

export class SkillInUse extends Error {
  readonly blocks: string[];
  constructor(blocks: string[]) {
    super(`used by ${blocks.join(", ")}`);
    this.blocks = blocks;
  }
}

/** Remove a skill. Throws SkillInUse (with the block labels) while a scenario still calls it. */
export function removeSkill(doc: BotDoc, id: string): BotDoc {
  const used = skillUsedBy(doc, id);
  if (used.length > 0) throw new SkillInUse(used);
  return { ...doc, skills: without(doc.skills ?? {}, id) };
}

/** Write one skill's fields back into the document (as given — never trimmed). */
export function writeSkill(doc: BotDoc, id: string, skill: SkillDoc): BotDoc {
  return { ...doc, skills: { ...doc.skills, [id]: skill } };
}

/** An id the engine would accept and that is not already another skill's. */
export function validateSkillId(id: string, doc: BotDoc): string | null {
  if (!id) return "id를 입력해 주세요";
  if (id.length > 64) return "id는 64자 이하여야 해요";
  if (!SKILL_ID_PATTERN.test(id)) return "소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있어요";
  if ((BUILTIN_ACTIONS as readonly string[]).includes(id)) return "기본 액션과 같은 id는 쓸 수 없어요";
  if (doc.skills?.[id]) return "이미 있는 id예요";
  return null;
}

/** The engine's rule (chatcore bot/schema.py SKILL_URL): http(s)://host..., no spaces, at most 2000 characters. */
const ENGINE_URL = /^https?:\/\/[^\s/?#]+\S*$/;

/** `required: false`: an empty value is fine (e.g. 테스트 URL). */
export function validateUrl(value: string, required = true): string | null {
  if (!value) return required ? "주소를 입력해 주세요" : null;
  if (value.length > 2000) return "2000자까지 쓸 수 있어요";
  if (!isAscii(value)) return "ASCII 문자만 쓸 수 있어요";
  if (!ENGINE_URL.test(value)) return "http:// 또는 https://와 호스트로 시작하고, 공백이 없어야 해요";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "주소 형식이 올바르지 않아요";
  }
  if (!url.hostname) return "호스트가 없어요";
  return null;
}

export function validateTimeout(ms: number): string | null {
  return Number.isInteger(ms) && ms >= SKILL_TIMEOUT.min && ms <= SKILL_TIMEOUT.max
    ? null : `${SKILL_TIMEOUT.min}~${SKILL_TIMEOUT.max} 사이의 정수여야 해요`;
}

export function validateHeaderName(name: string): string | null {
  if (!name) return "헤더 이름을 입력해 주세요";
  if (!HEADER_NAME_PATTERN.test(name)) return "헤더 이름 형식이 올바르지 않아요";
  return null;
}

/** ASCII, no line breaks, and the only `{{ }}` allowed is `{{ secret.NAME }}`. */
export function validateHeaderValue(value: string): string | null {
  if (!isAscii(value)) return "ASCII 문자만 쓸 수 있어요";
  if (/[\r\n\0]/.test(value)) return "줄바꿈과 NUL 문자는 쓸 수 없어요";
  if (/\{\{|\}\}/.test(value.replace(SECRET_TEMPLATE, ""))) return "{{ secret.이름 }} 형식만 쓸 수 있어요";
  return null;
}

/** Secret names a header value already refers to. */
export function secretNamesIn(value: string): string[] {
  return [...value.matchAll(SECRET_TEMPLATE)].map((m) => m[1] as string);
}
