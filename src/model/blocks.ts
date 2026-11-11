// Blocks (the builder's unit, docs/builder-plan.md §2.1) over the engine's document:
// a block is one scenario; a trigger block also owns the intent that starts it.
// read → write must give back the same document (tested over the whole sample bot).
import {
  blockTargets, type BotDoc, newId, type QuickReplyDoc, quickReplyLabel, REQUIRED_RESPONSES, type ReplyKind, type ResponseDoc,
  type RichBodyDoc, richOf, responseTexts, type ScenarioDoc, type SlotDoc, type Step, withRich, withTexts, without,
} from "./doc";

export interface Reply {
  response: string; // response id
  kind: ReplyKind; // text, or one rich body
  texts: string[]; // kind "text": one text, or several variants picked at random
  rich: RichBodyDoc | null; // the rich body (kind other than "text")
  quickReplies: QuickReplyDoc[]; // as stored: a string sends itself
  /** Another reply or question of this block shows the same response: edit it there (read-only here). */
  sharedWith?: string;
  /** The document names this response but does not define it. Written only once given text. */
  missing?: boolean;
}

export interface Param {
  name: string; // slot name
  entity: string; // entity id or sys.*
  ask: Reply | null; // the re-ask question (optional parameters may have none)
  required: boolean; // false: taken from the user's words, never asked
  default: string | number | null; // optional parameters: the value when the user gave none
  /** A skill that checks the value (engine: slot.validation); `fail` is said when it refuses. */
  validation: { action: string; fail: Reply } | null;
}

export interface Block {
  id: string; // scenario id
  label: string;
  group: string; // folder in the block list ("" = none)
  intent: string | null; // trigger intent; null: started only by other blocks (call / branch)
  examples: string[];
  params: Param[];
  replies: Reply[]; // the respond steps, in order
  steps: Step[]; // every step in order; params and replies are views onto it
}

export type BlockKind = "trigger" | "called";

export const kindOf = (block: Pick<Block, "intent">): BlockKind => (block.intent ? "trigger" : "called");

/** A response as the editor sees it. `sharedWith`: shown read-only, owned elsewhere. */
export const replyOf = (doc: BotDoc, id: string, sharedWith?: string): Reply => {
  const stored = doc.responses[id];
  const rich = richOf(stored);
  return {
    response: id,
    kind: rich?.kind ?? "text",
    texts: stored && !rich ? responseTexts(stored) : rich ? [] : [],
    rich: rich ? structuredClone(rich.body) : null,
    quickReplies: structuredClone(stored?.quick_replies ?? []),
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
  const params = Object.entries(scenario.slots ?? {}).map(([name, slot]): Param => ({
    name, entity: slot.entity,
    ask: slot.ask ? replyOf(doc, slot.ask, claim(slot.ask, `파라미터 ${name}의 질문`)) : null,
    required: slot.required !== false,
    default: slot.default ?? null,
    validation: slot.validation
      ? { action: slot.validation.action, fail: replyOf(doc, slot.validation.fail, claim(slot.validation.fail, `파라미터 ${name}의 검증 실패`)) }
      : null,
  }));
  let n = 0;
  const replies = scenario.steps.flatMap((step) => {
    if (!("respond" in step)) return [];
    n += 1;
    return [replyOf(doc, step.respond, claim(step.respond, `응답 ${n}`))];
  });
  return {
    id,
    label: scenario.label ?? "",
    group: scenario.group ?? "",
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

/** Write a reply into the document's responses (in place). */
export function writeResponse(doc: BotDoc, reply: Reply): void {
  if (reply.sharedWith) return; // the owning reply writes it
  const empty = reply.kind === "text" ? reply.texts.every((t) => !t) : reply.rich === null;
  if (reply.missing && empty && reply.quickReplies.length === 0) return; // still undefined
  const stored = doc.responses[reply.response];
  doc.responses[reply.response] = reply.kind !== "text" && reply.rich
    ? withRich(stored, reply.kind, reply.rich, reply.quickReplies)
    : withTexts(stored, reply.texts.length ? reply.texts : [""], reply.quickReplies);
}

/** One slot as stored: keeps fields the builder does not edit (e.g. validation); writes only what differs from the defaults. */
function slotDoc(before: SlotDoc | undefined, param: Param): SlotDoc {
  const slot: SlotDoc = { ...before, entity: param.entity };
  if (param.ask) slot.ask = param.ask.response;
  else if (slot.ask !== null) delete slot.ask; // an explicit null stays
  if (!param.required || before?.required !== undefined) slot.required = param.required;
  if (param.default !== null && param.default !== "" && !param.required) slot.default = param.default;
  else if (slot.default !== null || param.required === false) delete slot.default;
  if (param.validation) slot.validation = { action: param.validation.action, fail: param.validation.fail.response };
  else if (slot.validation !== null) delete slot.validation;
  return slot;
}

/** The document with this block written into it (a new object; `doc` is not changed). */
export function writeBlock(doc: BotDoc, block: Block): BotDoc {
  const next = structuredClone(doc);
  const before: ScenarioDoc | undefined = next.scenarios[block.id];
  const scenario: ScenarioDoc = { ...before, steps: block.steps.map((s) => structuredClone(s)) };
  if (block.label || before?.label !== undefined) scenario.label = block.label;
  if (block.group.trim()) scenario.group = block.group; // as typed: trimming here would eat the space being typed
  else if (scenario.group !== null) delete scenario.group;
  if (block.params.length > 0 || before?.slots !== undefined) {
    scenario.slots = Object.fromEntries(block.params.map((p) => [p.name, slotDoc(before?.slots?.[p.name], p)]));
  }
  if (block.intent) {
    scenario.trigger = { intent: block.intent };
    next.intents = { ...next.intents, [block.intent]: { ...next.intents?.[block.intent], examples: [...block.examples] } };
  }
  next.scenarios[block.id] = scenario;
  for (const param of block.params) {
    if (param.ask) writeResponse(next, param.ask);
    if (param.validation) writeResponse(next, param.validation.fail);
  }
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
  return { ...block, replies: [...block.replies, textReply(response, text)], steps: [...block.steps, { respond: response }] };
}

export const textReply = (response: string, text = ""): Reply => ({ response, kind: "text", texts: [text], rich: null, quickReplies: [] });

export function removeReply(block: Block, index: number): Block {
  const reply = block.replies[index];
  if (!reply) return block;
  let seen = -1;
  const steps = block.steps.filter((step) => !("respond" in step && ++seen === index));
  return { ...block, replies: block.replies.filter((_, i) => i !== index), steps };
}

export function addParam(doc: BotDoc, block: Block, entity: string): Block {
  const name = newId("param", block.params.map((p) => p.name));
  const ask = newId(`${block.id}_ask`, [...Object.keys(doc.responses), ...block.params.flatMap((p) => (p.ask ? [p.ask.response] : []))]);
  // parameters are asked before anything else runs, after the ones already there (like the engine's collect order)
  const lastCollect = block.steps.reduce((at, step, i) => ("collect" in step ? i : at), -1);
  const steps = [...block.steps];
  steps.splice(lastCollect + 1, 0, { collect: name });
  return { ...block, params: [...block.params, { name, entity, ask: textReply(ask), required: true, default: null, validation: null }], steps };
}

/** Where this block's texts, skill arguments or branches read the parameter ({{ slots.name }}). */
export function paramUses(doc: BotDoc, block: Block, name: string): string[] {
  const pattern = new RegExp(`\\{\\{\\s*slots\\.${name}\\b`);
  const uses: string[] = [];
  const onError = doc.scenarios[block.id]?.on_error;
  const responses = new Set([...block.replies.map((r) => r.response),
    ...block.params.filter((p) => p.name !== name && p.ask).map((p) => (p.ask as Reply).response), ...(onError ? [onError] : [])]);
  for (const response of responses) {
    if (responseStrings(doc.responses[response]).some((t) => pattern.test(t))) uses.push(`응답 ${response}`);
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
    id, label: input.label.trim(), group: "", intent: id, examples: [input.example.trim()], params: [],
    replies: [textReply(response, input.reply.trim())], steps: [{ respond: response }],
  };
  return { doc: writeBlock(doc, block), id };
}

/** Responses something still uses: the engine's own, steps, questions, error and system notices. */
export function responseRefs(doc: BotDoc): Set<string> {
  const refs = new Set<string>(REQUIRED_RESPONSES);
  for (const scenario of Object.values(doc.scenarios)) {
    for (const step of scenario.steps) if ("respond" in step) refs.add(step.respond);
    for (const slot of Object.values(scenario.slots ?? {})) {
      if (slot.ask) refs.add(slot.ask);
      if (slot.validation?.fail) refs.add(slot.validation.fail);
    }
    if (scenario.on_error) refs.add(scenario.on_error);
  }
  const notice = doc.system?.timeout?.notice;
  if (notice) refs.add(notice);
  return refs;
}

/** Every string of a response that may hold a {{ template }}: texts, rich fields, quick replies. */
export function responseStrings(response: ResponseDoc | undefined): string[] {
  if (!response) return [];
  const strings = (value: unknown, key = ""): string[] => {
    if (typeof value === "string") return ["action", "type", "block_id"].includes(key) ? [] : [value];
    if (Array.isArray(value)) return value.flatMap((v) => strings(v, key));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, k));
    return [];
  };
  const rich = richOf(response);
  return [...(rich ? strings(rich.body) : responseTexts(response)), ...strings(response.quick_replies ?? [])];
}

/** What starts `id` from elsewhere: other blocks' call / branch steps, buttons and quick replies that
 * move to it, and the welcome / escape settings. Deleting it would break them. */
export function callersOf(doc: BotDoc, id: string): string[] {
  const steps = Object.entries(doc.scenarios)
    .filter(([sid, s]) => sid !== id && s.steps.some((step) =>
      ("call" in step && step.call === id)
      || ("branch" in step && (Object.values(step.branch.cases).includes(id) || step.branch.default === id))))
    .map(([sid]) => sid);
  // responses that go away with the block (used by it alone) do not count: its own "다시" button is fine
  const others = responseRefs({ ...doc, scenarios: without(doc.scenarios, id) });
  const own = [...responseRefs({ ...doc, scenarios: { [id]: doc.scenarios[id] ?? { steps: [] } }, system: {} })].filter((r) => !others.has(r));
  const buttons = Object.entries(doc.responses).filter(([rid, r]) => !own.includes(rid) && blockTargets(r).includes(id))
    .map(([rid]) => `버튼(응답 ${rid})`);
  const system = [...(doc.system?.welcome === id ? ["웰컴"] : []), ...(doc.system?.escape?.scenario === id ? ["탈출"] : [])];
  return [...steps, ...buttons, ...system];
}

/** Blocks only the welcome / escape settings start (no trigger): edited under 기본 시나리오, not listed
 * with the other blocks. A trigger block chosen there stays in the list too. */
export function systemScenarios(doc: BotDoc): Set<string> {
  return new Set([doc.system?.welcome, doc.system?.escape?.scenario]
    .filter((s): s is string => !!s && !!doc.scenarios[s] && !doc.scenarios[s]?.trigger));
}

/** Labels shown on a response's quick replies (for previews and warnings). */
export const replyLabels = (reply: Reply): string[] => reply.quickReplies.map(quickReplyLabel);

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

// ---------------------------------------------------------------- skills a block calls (action steps)

export interface SkillStep {
  index: number; // position in block.steps
  action: string;
  args: Record<string, string>;
}

export function skillSteps(block: Block): SkillStep[] {
  return block.steps.flatMap((step, index) => ("action" in step ? [{ index, action: step.action, args: { ...step.args } }] : []));
}

/** Call a skill after the parameters are collected and before the first reply (the order a Kakao block runs in). */
export function addSkillStep(block: Block, action: string): Block {
  const firstRespond = block.steps.findIndex((step) => "respond" in step);
  const lastCollect = block.steps.reduce((at, step, i) => ("collect" in step ? i : at), -1);
  const at = firstRespond === -1 ? block.steps.length : Math.max(firstRespond, lastCollect + 1);
  const steps = [...block.steps];
  steps.splice(at, 0, { action, args: {} });
  return { ...block, steps };
}

export function updateSkillStep(block: Block, index: number, action: string, args: Record<string, string>): Block {
  const step = block.steps[index];
  if (!step || !("action" in step)) return block;
  const steps = [...block.steps];
  steps[index] = Object.keys(args).length > 0 || step.args !== undefined ? { ...step, action, args } : { ...step, action };
  return { ...block, steps };
}

export function removeSkillStep(block: Block, index: number): Block {
  const step = block.steps[index];
  if (!step || !("action" in step)) return block;
  return { ...block, steps: block.steps.filter((_, i) => i !== index) };
}
