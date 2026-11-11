// HTTP skills (engine E10): running a saved skill as a test, its error log, and per-bot secrets.
import { bot, request } from "./client";
import type { components } from "./schema";

type S = components["schemas"];
export type SkillTestOut = S["SkillTestOut"];
export type SkillErrorOut = S["SkillErrorOut"];
export type SkillErrorKind = SkillErrorOut["kind"];
export type SecretOut = S["SecretOut"];

/** Run the SAVED draft's skill (its test_url when set). Never throws for the skill's own failure —
 * that is `result.error`; only a request the engine itself could not answer raises. 404 when the
 * saved draft has no such skill. */
export async function testSkill(id: string, skill: string, params: Record<string, string>, utterance: string): Promise<SkillTestOut> {
  const res = await request(`${bot(id)}/skills/${encodeURIComponent(skill)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params, utterance }),
  });
  return (await res.json()) as SkillTestOut;
}

export async function listSkillErrors(id: string, limit = 100): Promise<SkillErrorOut[]> {
  const res = await request(`${bot(id)}/skills/errors?limit=${limit}`);
  return ((await res.json()) as { items: SkillErrorOut[] }).items;
}

export async function listSecrets(id: string): Promise<SecretOut[]> {
  const res = await request(`${bot(id)}/secrets`);
  return ((await res.json()) as { items: SecretOut[] }).items;
}

/** 422: the value is not 1-4000 ASCII characters with no line break. */
export async function setSecret(id: string, name: string, value: string): Promise<void> {
  await request(`${bot(id)}/secrets/${encodeURIComponent(name)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }),
  });
}

/** 404 when the secret does not exist. */
export async function deleteSecret(id: string, name: string): Promise<void> {
  await request(`${bot(id)}/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
}

const SKILL_ERROR_KIND_LABEL: Record<SkillErrorKind, string> = {
  blocked: "내부 주소라 막혔어요",
  network: "연결하지 못했어요",
  timeout: "시간 안에 답하지 않았어요",
  http_status: "HTTP {status} 응답",
  invalid_response: "JSON 객체가 아닌 응답",
  too_large: "응답이 64KB를 넘어요",
  secret_missing: "비밀값이 없거나 헤더로 보낼 수 없어요",
};

/** The Korean message for one error kind (http_status fills in the real status code). */
export function skillErrorMessage(kind: SkillErrorKind, status: number | null): string {
  return SKILL_ERROR_KIND_LABEL[kind].replace("{status}", String(status ?? "?"));
}
