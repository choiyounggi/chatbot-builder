import { describe, expect, it } from "vitest";
import sample from "../test/fixtures/sample-bot.json";
import {
  addParam, addReply, BlockInUse, callersOf, createBlock, deleteBlock, kindOf, listBlocks, looseIntents, paramUses,
  ParamInUse, readBlock, removeParam, removeReply, sameDoc, writeBlock,
} from "./blocks";
import { type BotDoc, newId, type ScenarioDoc, withTexts } from "./doc";

const SAMPLE = sample as unknown as BotDoc;

describe("blocks over the engine document", () => {
  it("round-trips every scenario of the sample bot to the same document", () => {
    for (const id of Object.keys(SAMPLE.scenarios)) {
      expect(sameDoc(writeBlock(SAMPLE, readBlock(SAMPLE, id)), SAMPLE), id).toBe(true);
    }
  });

  it("reads a trigger block with its examples, parameter and replies", () => {
    const weather = readBlock(SAMPLE, "check_weather");
    expect(kindOf(weather)).toBe("trigger");
    expect(weather.intent).toBe("weather");
    expect(weather.examples).toEqual(SAMPLE.intents?.weather?.examples);
    expect(weather.params).toEqual([{ name: "location", entity: "location",
      ask: { response: "ask_location", texts: [SAMPLE.responses.ask_location?.text], quickReplies: ["서울", "부산", "제주"] } }]);
    expect(weather.replies.map((r) => r.response)).toEqual(["weather_report"]);
    expect(weather.steps.map((s) => Object.keys(s)[0])).toEqual(["collect", "action", "respond"]);
    expect(listBlocks(SAMPLE)).toHaveLength(9);
    expect(looseIntents(SAMPLE)).toEqual(["out_of_scope"]);
    expect(() => readBlock(SAMPLE, "nope")).toThrow("no scenario nope");
  });

  it("does not change the document it was given", () => {
    const before = JSON.stringify(SAMPLE);
    const block = readBlock(SAMPLE, "greet");
    writeBlock(SAMPLE, { ...block, label: "다른 이름", examples: ["안녕"] });
    expect(JSON.stringify(SAMPLE)).toBe(before);
  });

  it("adds and removes replies with their respond steps and responses", () => {
    const greet = readBlock(SAMPLE, "greet");
    const added = addReply(SAMPLE, greet, "또 만나요");
    expect(added.replies.at(-1)?.response).toBe("greet_reply_1");
    expect(added.steps.at(-1)).toEqual({ respond: "greet_reply_1" });
    const written = writeBlock(SAMPLE, added);
    expect(written.responses.greet_reply_1).toEqual({ text: "또 만나요" });
    const removed = removeReply(readBlock(written, "greet"), 1);
    expect(removed.steps.filter((s) => "respond" in s)).toHaveLength(1);
    const back = writeBlock(written, removed);
    expect(back.responses.greet_reply_1).toBeUndefined(); // orphan cleaned up
    expect(sameDoc(back, SAMPLE)).toBe(true);
    expect(removeReply(greet, 9)).toBe(greet); // out of range: unchanged
  });

  it("adds parameters before the other steps and removes them with their question", () => {
    const time = readBlock(SAMPLE, "current_time"); // action, respond
    const added = addParam(SAMPLE, time, "sys.date");
    expect(added.steps[0]).toEqual({ collect: "param_1" });
    const written = writeBlock(SAMPLE, { ...added, params: added.params.map((p) => ({ ...p, ask: { ...p.ask, texts: ["언제요?"] } })) });
    expect(written.scenarios.current_time?.slots).toEqual({ param_1: { entity: "sys.date", ask: "current_time_ask_1" } });
    expect(written.responses.current_time_ask_1).toEqual({ text: "언제요?" });
    const second = addParam(written, readBlock(written, "current_time"), "location");
    expect(second.steps.slice(0, 2)).toEqual([{ collect: "param_1" }, { collect: "param_2" }]); // after the existing one
    const back = writeBlock(written, removeParam(readBlock(written, "current_time"), "param_1"));
    expect(back.responses.current_time_ask_1).toBeUndefined();
    expect(back.scenarios.current_time?.steps).toEqual(SAMPLE.scenarios.current_time?.steps);
  });

  it("creates trigger blocks with fresh ids", () => {
    const { doc, id } = createBlock(SAMPLE, { label: " 쿠폰 안내 ", example: " 쿠폰 어디서 받아요 ", reply: "쿠폰함에서 받아요" });
    expect(id).toBe("block_1");
    expect(doc.scenarios.block_1).toEqual({ label: "쿠폰 안내", trigger: { intent: "block_1" }, steps: [{ respond: "block_1_reply_1" }] });
    expect(doc.intents?.block_1).toEqual({ examples: ["쿠폰 어디서 받아요"] });
    expect(doc.responses.block_1_reply_1).toEqual({ text: "쿠폰함에서 받아요" });
    expect(createBlock(doc, { label: "b", example: "e", reply: "r" }).id).toBe("block_2");
  });

  it("deletes a block with its intent and own responses, and refuses while others call it", () => {
    const after = deleteBlock(SAMPLE, "check_weather");
    expect(after.scenarios.check_weather).toBeUndefined();
    expect(after.intents?.weather).toBeUndefined();
    expect(after.responses.weather_report).toBeUndefined();
    expect(after.responses.ask_location).toBeDefined(); // check_temperature asks with it too
    expect(after.responses.weather_unavailable).toBeDefined(); // on_error of check_temperature
    expect(after.responses.fallback).toBeDefined(); // the engine needs it
    const calling: BotDoc = structuredClone(SAMPLE);
    calling.scenarios.greet = { ...(calling.scenarios.greet as ScenarioDoc), steps: [{ call: "show_help" }] };
    expect(callersOf(calling, "show_help")).toEqual(["greet"]);
    expect(() => deleteBlock(calling, "show_help")).toThrow(BlockInUse);
  });
});

describe("document helpers", () => {
  it("keeps a response's shape when its texts change", () => {
    expect(withTexts({ text: "a" }, ["b"], [])).toEqual({ text: "b" });
    expect(withTexts({ text: "a" }, ["b", "c"], [])).toEqual({ variants: ["b", "c"] });
    expect(withTexts({ variants: ["a", "b"] }, ["c"], [])).toEqual({ variants: ["c"] });
    expect(withTexts({ text: "a", quick_replies: ["x"] }, ["a"], [])).toEqual({ text: "a", quick_replies: [] });
    expect(withTexts(undefined, [], ["y"])).toEqual({ text: "", quick_replies: ["y"] });
  });

  it("makes ids the engine accepts and that are not taken", () => {
    expect(newId("block", [])).toBe("block_1");
    expect(newId("block", ["block_1", "block_3"])).toBe("block_2");
    expect(newId("block", ["block_1"])).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe("documents shaped unlike the sample", () => {
  const base = (): BotDoc => ({
    id: "t", scenarios: {}, responses: { fallback: { text: "f" }, hi: { text: "안녕" }, bye: { variants: ["잘 가", "안녕히"] } },
    intents: { greet: { examples: ["안녕"] } },
  });

  it("lets the first use of a shared response own it and keeps later uses read-only", () => {
    const doc = base();
    doc.scenarios.s = { trigger: { intent: "greet" }, slots: { name: { entity: "sys.text", ask: "hi" } }, steps: [{ respond: "hi" }, { respond: "hi" }] };
    const block = readBlock(doc, "s");
    expect(block.params[0]?.ask.sharedWith).toBeUndefined();
    expect(block.replies.map((r) => r.sharedWith)).toEqual(["파라미터 name의 질문", "파라미터 name의 질문"]);
    const edited = { ...block, params: block.params.map((p) => ({ ...p, ask: { ...p.ask, texts: ["이름이 뭐예요?"] } })) };
    expect(writeBlock(doc, edited).responses.hi).toEqual({ text: "이름이 뭐예요?" }); // not overwritten by the stale replies
    expect(sameDoc(writeBlock(doc, block), doc)).toBe(true);
  });

  it("does not invent a response the document names but lacks, until it gets text", () => {
    const doc = base();
    doc.scenarios.s = { trigger: { intent: "greet" }, steps: [{ respond: "ghost" }] };
    const block = readBlock(doc, "s");
    expect(block.replies[0]).toMatchObject({ response: "ghost", missing: true, texts: [] });
    expect(sameDoc(writeBlock(doc, { ...block, label: "이름만" }), { ...doc, scenarios: { s: { ...(doc.scenarios.s as ScenarioDoc), label: "이름만" } } })).toBe(true);
    const filled = writeBlock(doc, { ...block, replies: block.replies.map((r) => ({ ...r, texts: ["이제 있어요"] })) });
    expect(filled.responses.ghost).toEqual({ text: "이제 있어요" });
  });

  it("keeps an intent another scenario still starts with", () => {
    const doc = base();
    doc.scenarios.a = { trigger: { intent: "greet" }, steps: [{ respond: "hi" }] };
    doc.scenarios.b = { trigger: { intent: "greet" }, steps: [{ respond: "bye" }] };
    const after = deleteBlock(doc, "a");
    expect(after.intents?.greet).toBeDefined();
    expect(after.responses.hi).toBeUndefined();
    expect(after.responses.bye).toEqual({ variants: ["잘 가", "안녕히"] });
  });

  it("refuses to remove a parameter the block still reads, including in its error reply", () => {
    const weather = readBlock(SAMPLE, "check_weather");
    expect(paramUses(SAMPLE, weather, "location")).toEqual(["응답 weather_report", "응답 weather_unavailable", "스킬 get_weather"]);
    expect(() => removeParam(weather, "location", SAMPLE)).toThrow(ParamInUse);
    const withNew = addParam(SAMPLE, weather, "sys.date");
    expect(removeParam(withNew, "param_1", SAMPLE).params.map((p) => p.name)).toEqual(["location"]);
    const branching = { ...weather, steps: [...weather.steps, { branch: { on: "slots.location", cases: { 서울: "greet" } } }] };
    expect(paramUses(SAMPLE, { ...branching, replies: [] }, "location")).toContain("분기");
  });

  it("uses the preferred id for a new block when it is free", () => {
    expect(createBlock(SAMPLE, { label: "a", example: "b", reply: "c" }, "block_7").id).toBe("block_7");
    expect(createBlock(SAMPLE, { label: "a", example: "b", reply: "c" }, "greeting").id).toBe("block_1"); // an intent id is taken
  });
});
