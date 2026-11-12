// LLM-proposed block examples and FAQ similar questions (engine E-H), screened by the engine.
import { bot, request } from "./client";
import type { components } from "./schema";

export type AugmentOut = components["schemas"]["AugmentOut"];
export type Proposal = components["schemas"]["ProposalOut"];
export type AugmentKind = "intent" | "faq";

/** 409: the engine has no LLM; 404: the block or FAQ is not in what is saved; 424: the LLM failed. */
export async function augment(id: string, kind: AugmentKind, target: string, count: number): Promise<AugmentOut> {
  const res = await request(`${bot(id)}/augment`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id: target, count }),
  });
  return (await res.json()) as AugmentOut;
}

export const PROPOSAL_TYPE: Record<Proposal["type"], string> = {
  typo: "오타", casual: "구어체", paraphrase: "다른 표현", synonym: "동의어",
};

export const PROPOSAL_STATUS: Record<Proposal["status"], string> = {
  ok: "", duplicate: "이미 있어요", invalid: "쓸 수 없어요", conflict: "헷갈려요",
};
