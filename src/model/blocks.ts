// Blocks (the builder's unit, docs/builder-plan.md §2.1) over the engine's document:
// a block is one scenario; a trigger block also owns the intent that starts it.
// read → write must give back the same document (tested over the whole sample bot).
import {
  type BotDoc, newId, REQUIRED_RESPONSES, type ResponseDoc, responseTexts, type ScenarioDoc, type Step, withTexts, without,
} from "./doc";

export interface Reply {
  response: string; // response id
  texts: string[]; // one text, or several variants picked at random
  quickReplies: string[];
  /** Another reply or question of this block shows the same response: edit it there (read-only here). */
  sharedWith?: string;
  /** The document names this response but does not define it. Written only once given text. */
  missing?: boolean;
}

export interface Param {
  name: string; // slot name
  entity: string; // entity id or sys.*
  ask: Reply; // the re-ask question
}

export interface Block {
  id: string; // scenario id
  label: string;
  intent: string | null; // trigger intent; null: started only by other blocks (call / branch)
  examples: string[];
  params: Param[];
  replies: Reply[]; // the respond steps, in order
  steps: Step[]; // every step in order; params and replies are views onto it
}

export type BlockKind = "trigger" | "called";

export const kindOf = (block: Pick<Block, "intent">): BlockKind => (block.intent ? "trigger" : "called");

const replyOf = (doc: BotDoc, id: string, sharedWith?: string): Reply => {
  const stored = doc.responses[id];
  return {
    response: id,
    texts: stored ? responseTexts(stored) : [],
    quickReplies: [...(stored?.quick_replies ?? [])],
    ...(sharedWith ? { sharedWith } : {}),
    ...(stored ? {} : { missing: true }),
  };
};

export function readBlock(doc: BotDoc, id: string): Block {
  const scenario = doc.scenarios[id];
  if (!scenario) throw new Error(`no scenario ${id}`);
  const intent = scenario.trigger?.intent ?? null;
  // the first place a response appears in the block owns it; later ones show it read-only
  const owner = new Map<string, string>();
  const claim = (response: string, where: string) => {
    const first = owner.get(response);
    if (!first) owner.set(response, where);
    return first;
  };
  const params = Object.entries(scenario.slots ?? {}).map(([name, slot]) => (
    { name, entity: slot.entity, ask: replyOf(doc, slot.ask, claim(slot.ask, `파라미터 ${name}의 질문`)) }));
  let n = 0;
  const replies = scenario.steps.flatMap((step) => {
    if (!("respond" in step)) return [];
    n += 1;
    return [replyOf(doc, step.respond, claim(step.respond, `응답 ${n}`))];
  });
  return {
    id,
    label: scenario.label ?? "",
    intent,
    examples: intent ? [...(doc.intents?.[intent]?.examples ?? [])] : [],
    params,
    replies,
    steps: scenario.steps.map((step) => structuredClone(step)),
  };
}

export function listBlocks(doc: BotDoc): Block[] {
  return Object.keys(doc.scenarios).map((id) => readBlock(doc, id));
}

/** Intents no scenario starts with (e.g. out_of_scope): they still train the classifier. */
export function looseIntents(doc: BotDoc): string[] {
  const triggers = new Set(Object.values(doc.scenarios).map((s) => s.trigger?.intent).filter(Boolean));
  return Object.keys(doc.intents ?? {}).filter((id) => !triggers.has(id));
}

function writeResponse(doc: BotDoc, reply: Reply): void {
  if (reply.sharedWith) return; // the owning reply writes it
  if (reply.missing && reply.texts.every((t) => !t) && reply.quickReplies.length === 0) return; // still undefined
  doc.responses[reply.response] = withTexts(doc.responses[reply.response], reply.texts.length ? reply.texts : [""], reply.quickReplies);
}

/** The document with this block written into it (a new object; `doc` is not changed). */
export function writeBlock(doc: BotDoc, block: Block): BotDoc {
  const next = structuredClone(doc);
  const before: ScenarioDoc | undefined = next.scenarios[block.id];
  const scenario: ScenarioDoc = { ...before, steps: block.steps.map((s) => structuredClone(s)) };
  if (block.label || before?.label !== undefined) scenario.label = block.label;
  if (block.params.length > 0 || before?.slots !== undefined) {
    scenario.slots = Object.fromEntries(block.params.map((p) => [p.name, { entity: p.entity, ask: p.ask.response }]));
  }
  if (block.intent) {
    scenario.trigger = { intent: block.intent };
    next.intents = { ...next.intents, [block.intent]: { ...next.intents?.[block.intent], examples: [...block.examples] } };
  }
  next.scenarios[block.id] = scenario;
  for (const param of block.params) writeResponse(next, param.ask);
  for (const reply of block.replies) writeResponse(next, reply);
  // a removed reply or parameter leaves its response behind: drop it unless something else uses it
  if (before) {
    const used = responseRefs(next);
    const orphans = [...responseRefs({ ...doc, scenarios: { [block.id]: before } })].filter((r) => !used.has(r));
    next.responses = without(next.responses, ...orphans);
  }
  return next;
}

// ---------------------------------------------------------------- edits on a block

export function addReply(doc: BotDoc, block: Block, text = ""): Block {
  const response = newId(`${block.id}_reply`, [...Object.keys(doc.responses), ...block.replies.map((r) => r.response)]);
  return { ...block, replies: [...block.replies, { response, texts: [text], quickReplies: [] }], steps: [...block.steps, { respond: response }] };
}

export function removeReply(block: Block, index: number): Block {
  const reply = block.replies[index];
  if (!reply) return block;
  let seen = -1;
  const steps = block.steps.filter((step) => !("respond" in step && ++seen === index));
  return { ...block, replies: block.replies.filter((_, i) => i !== index), steps };
}

export function addParam(doc: BotDoc, block: Block, entity: string): Block {
  const name = newId("param", block.params.map((p) => p.name));
  const ask = newId(`${block.id}_ask`, [...Object.keys(doc.responses), ...block.params.map((p) => p.ask.response)]);
  // parameters are asked before anything else runs, after the ones already there (like the engine's collect order)
  const lastCollect = block.steps.reduce((at, step, i) => ("collect" in step ? i : at), -1);
  const steps = [...block.steps];
  steps.splice(lastCollect + 1, 0, { collect: name });
  return { ...block, params: [...block.params, { name, entity, ask: { response: ask, texts: [""], quickReplies: [] } }], steps };
}

/** Where this block's texts, skill arguments or branches read the parameter ({{ slots.name }}). */
export function paramUses(doc: BotDoc, block: Block, name: string): string[] {
  const pattern = new RegExp(`\\{\\{\\s*slots\\.${name}\\b`);
  const uses: string[] = [];
  const onError = doc.scenarios[block.id]?.on_error;
  const responses = new Set([...block.replies.map((r) => r.response), ...block.params.filter((p) => p.name !== name).map((p) => p.ask.response),
    ...(onError ? [onError] : [])]);
  for (const response of responses) {
    if (responseTexts(doc.responses[response]).some((t) => pattern.test(t))) uses.push(`응답 ${response}`);
  }
  for (const step of block.steps) {
    if ("action" in step && Object.values(step.args ?? {}).some((v) => pattern.test(v))) uses.push(`스킬 ${step.action}`);
    if ("branch" in step && new RegExp(`^slots\\.${name}\\b`).test(step.branch.on)) uses.push("분기");
  }
  return uses;
}

export class ParamInUse extends Error {
  readonly uses: string[];
  constructor(uses: string[]) {
    super(`used by ${uses.join(", ")}`);
    this.uses = uses;
  }
}

/** Remove a parameter and its collect step. Throws ParamInUse while the block still reads it. */
export function removeParam(block: Block, name: string, doc?: BotDoc): Block {
  if (doc) {
    const uses = paramUses(doc, block, name);
    if (uses.length > 0) throw new ParamInUse(uses);
  }
  return {
    ...block,
    params: block.params.filter((p) => p.name !== name),
    steps: block.steps.filter((step) => !("collect" in step && step.collect === name)),
  };
}

// ---------------------------------------------------------------- whole blocks

export interface NewBlock {
  label: string;
  example: string;
  reply: string;
}

/** A trigger block: its own intent (one example) and one text reply. Returns the document and the block id. */
/** The id createBlock would give a new block in this document. */
export function newBlockId(doc: BotDoc): string {
  return newId("block", [...Object.keys(doc.scenarios), ...Object.keys(doc.intents ?? {})]);
}

export function createBlock(doc: BotDoc, input: NewBlock, preferredId?: string): { doc: BotDoc; id: string } {
  const taken = [...Object.keys(doc.scenarios), ...Object.keys(doc.intents ?? {})];
  const id = preferredId && !taken.includes(preferredId) ? preferredId : newId("block", taken);
  const response = newId(`${id}_reply`, Object.keys(doc.responses));
  const block: Block = {
    id, label: input.label.trim(), intent: id, examples: [input.example.trim()], params: [],
    replies: [{ response, texts: [input.reply.trim()], quickReplies: [] }], steps: [{ respond: response }],
  };
  return { doc: writeBlock(doc, block), id };
}

function responseRefs(doc: BotDoc): Set<string> {
  const refs = new Set<string>(REQUIRED_RESPONSES);
  for (const scenario of Object.values(doc.scenarios)) {
    for (const step of scenario.steps) if ("respond" in step) refs.add(step.respond);
    for (const slot of Object.values(scenario.slots ?? {})) refs.add(slot.ask);
    if (scenario.on_error) refs.add(scenario.on_error);
  }
  return refs;
}

/** Blocks that start `id` through call / branch steps: deleting it would break them. */
export function callersOf(doc: BotDoc, id: string): string[] {
  return Object.entries(doc.scenarios)
    .filter(([sid, s]) => sid !== id && s.steps.some((step) =>
      ("call" in step && step.call === id)
      || ("branch" in step && (Object.values(step.branch.cases).includes(id) || step.branch.default === id))))
    .map(([sid]) => sid);
}

/** Delete a block, its trigger intent and the responses nothing else uses. Throws when other blocks call it. */
export function deleteBlock(doc: BotDoc, id: string): BotDoc {
  const callers = callersOf(doc, id);
  if (callers.length > 0) throw new BlockInUse(callers);
  const next = structuredClone(doc);
  const intent = next.scenarios[id]?.trigger?.intent;
  next.scenarios = without(next.scenarios, id);
  const stillUsed = Object.values(next.scenarios).some((s) => s.trigger?.intent === intent);
  if (intent && next.intents && !stillUsed) next.intents = without(next.intents, intent);
  const used = responseRefs(next);
  const mine = responseRefs({ ...doc, scenarios: { [id]: doc.scenarios[id] ?? { steps: [] } } });
  next.responses = without(next.responses, ...[...mine].filter((r) => !used.has(r)));
  return next;
}

export class BlockInUse extends Error {
  readonly callers: string[];
  constructor(callers: string[]) {
    super(`called by ${callers.join(", ")}`);
    this.callers = callers;
  }
}

export function sameDoc(a: BotDoc | ResponseDoc | null | undefined, b: BotDoc | ResponseDoc | null | undefined): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}
