// B3 model: rich replies, quick replies that move to a block, optional parameters, block groups,
// references that block a deletion, and the system settings (welcome, escape, timeout, re-asks).
import { describe, expect, it } from "vitest";
import sample from "../test/fixtures/sample-bot.json";
import {
  BlockInUse, callersOf, deleteBlock, paramUses, readBlock, replyLabels, responseStrings, sameDoc, systemScenarios, writeBlock,
} from "./blocks";
import { blockTargets, type BotDoc, quickReplyBlock, richOf, withRich } from "./doc";
import {
  createWelcome, DEFAULT_MAX_ATTEMPTS, readSystem, setEscape, setMaxAttempts, setTimeoutMinutes, setTimeoutNotice, setWelcome, TIMEOUT_NOTICE,
} from "./system";

const SAMPLE = sample as unknown as BotDoc;

const CARD = {
  title: "{{ slots.location }} 날씨", description: "자세히 보기",
  thumbnail: { image_url: "https://example.com/w.png" },
  buttons: [{ label: "다시 묻기", action: "block" as const, block_id: "check_weather" },
    { label: "사이트", action: "web_link" as const, web_link_url: "https://example.com" }],
};

/** The sample bot with a card reply in check_weather and quick replies that move to blocks. */
function withCard(): BotDoc {
  const doc = structuredClone(SAMPLE);
  doc.responses.weather_report = { basic_card: CARD, quick_replies: ["고마워", { label: "기온", action: "block", block_id: "check_temperature" }] };
  return doc;
}

describe("rich replies", () => {
  it("reads a card reply with its kind, body and mixed quick replies, and writes it back unchanged", () => {
    const doc = withCard();
    const block = readBlock(doc, "check_weather");
    const reply = block.replies[0];
    expect(reply?.kind).toBe("basic_card");
    expect(reply?.rich).toEqual(CARD);
    expect(reply?.texts).toEqual([]);
    expect(reply && replyLabels(reply)).toEqual(["고마워", "기온"]);
    expect(sameDoc(writeBlock(doc, block), doc)).toBe(true);
  });

  it("switching a reply between text and a rich body replaces the old body", () => {
    const doc = withCard();
    const block = readBlock(doc, "check_weather");
    const asText = { ...block, replies: block.replies.map((r) => ({ ...r, kind: "text" as const, rich: null, texts: ["맑아요"] })) };
    expect(writeBlock(doc, asText).responses.weather_report).toEqual({ text: "맑아요", quick_replies: doc.responses.weather_report?.quick_replies });
    const image = { image_url: "https://example.com/a.png", alt_text: "그림" };
    const asImage = { ...block, replies: block.replies.map((r) => ({ ...r, kind: "simple_image" as const, rich: image })) };
    const written = writeBlock(doc, asImage).responses.weather_report;
    expect(written?.simple_image).toEqual(image);
    expect(written?.basic_card).toBeUndefined();
    expect(withRich({ variants: ["a", "b"] }, "carousel", { items: [{ title: "t" }] }, [])).toEqual({ carousel: { items: [{ title: "t" }] } });
  });

  it("finds rich bodies, block targets and every templated string", () => {
    const doc = withCard();
    const response = doc.responses.weather_report ?? {};
    expect(richOf(response)?.kind).toBe("basic_card");
    expect(richOf({ text: "a" })).toBeNull();
    expect(richOf(undefined)).toBeNull();
    expect(blockTargets(response).sort()).toEqual(["check_temperature", "check_weather"]);
    expect(blockTargets({ list_card: { header: { title: "h" }, items: [{ title: "i" }], buttons: [{ label: "b", action: "block", block_id: "greet" }] } }))
      .toEqual(["greet"]);
    expect(blockTargets({ carousel: { items: [CARD, { title: "x" }] } })).toEqual(["check_weather"]);
    expect(quickReplyBlock("서울")).toBeNull();
    expect(quickReplyBlock({ label: "x", action: "block" })).toBeNull(); // no target yet
    const strings = responseStrings(response);
    expect(strings).toContain("{{ slots.location }} 날씨");
    expect(strings).toContain("https://example.com/w.png");
    expect(strings).not.toContain("block"); // actions are not text
    expect(responseStrings(undefined)).toEqual([]);
  });

  it("a parameter used inside a card cannot be removed", () => {
    const doc = withCard();
    expect(paramUses(doc, readBlock(doc, "check_weather"), "location")).toContain("응답 weather_report");
    const plain = withCard();
    plain.responses.weather_report = { basic_card: { title: "날씨" } }; // no {{ slots.location }} in the card
    expect(paramUses(plain, readBlock(plain, "check_weather"), "location")).not.toContain("응답 weather_report");
  });
});

describe("parameters and groups", () => {
  it("writes optional parameters with a default, and drops the default when the parameter is required again", () => {
    const block = readBlock(SAMPLE, "check_weather");
    const optional = { ...block, params: block.params.map((p) => ({ ...p, required: false, default: "서울" })) };
    const written = writeBlock(SAMPLE, optional);
    expect(written.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location", required: false, default: "서울" });
    expect(readBlock(written, "check_weather").params[0]).toMatchObject({ required: false, default: "서울" });
    const again = readBlock(written, "check_weather");
    const required = writeBlock(written, { ...again, params: again.params.map((p) => ({ ...p, required: true })) });
    expect(required.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location", required: true });
    const blankDefault = writeBlock(SAMPLE, { ...block, params: block.params.map((p) => ({ ...p, required: false, default: "" })) });
    expect(blankDefault.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location", required: false });
  });

  it("keeps slot fields the builder does not edit, and a parameter without a question", () => {
    const doc = structuredClone(SAMPLE);
    doc.scenarios.check_weather = { ...doc.scenarios.check_weather, steps: doc.scenarios.check_weather?.steps ?? [],
      slots: { location: { entity: "location", required: false, validation: { action: "check", fail: "error" } } } };
    const block = readBlock(doc, "check_weather");
    expect(block.params[0]?.ask).toBeNull();
    expect(sameDoc(writeBlock(doc, block), doc)).toBe(true);
  });

  it("sets a block's group as typed and clears it when blank", () => {
    const block = readBlock(SAMPLE, "greet");
    const grouped = writeBlock(SAMPLE, { ...block, group: "첫 " }); // mid-typing "첫 만남": the space stays
    expect(grouped.scenarios.greet?.group).toBe("첫 ");
    expect(readBlock(grouped, "greet").group).toBe("첫 ");
    expect(sameDoc(writeBlock(grouped, { ...readBlock(grouped, "greet"), group: "  " }), SAMPLE)).toBe(true);
  });
});

describe("references", () => {
  it("a block that buttons, quick replies, welcome or escape start cannot be deleted", () => {
    let doc = withCard();
    expect(callersOf(doc, "check_temperature")).toEqual(["버튼(응답 weather_report)"]);
    expect(() => deleteBlock(doc, "check_temperature")).toThrow(BlockInUse);
    doc = setEscape(setWelcome(doc, "greet"), ["그만"], "show_help");
    expect(callersOf(doc, "greet")).toEqual(["웰컴"]);
    expect(callersOf(doc, "show_help")).toEqual(["탈출"]);
    expect(systemScenarios(doc)).toEqual(new Set()); // trigger blocks stay in the block list
    const welcome = createWelcome(doc, "어서 오세요");
    expect(systemScenarios(welcome.doc)).toEqual(new Set([welcome.id])); // a welcome-only block is edited under 기본 시나리오
    expect(callersOf(doc, "thank")).toEqual([]);
    expect(Object.keys(deleteBlock(doc, "thank").scenarios)).not.toContain("thank");
  });
});

describe("system settings", () => {
  it("reads defaults from a document without any of them", () => {
    expect(readSystem(SAMPLE)).toEqual({ welcome: null, escapePhrases: [], escapeScenario: null, timeoutMinutes: null,
      timeoutNotice: "", timeoutNoticeEditable: true, maxAttempts: 3 });
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it("creates a welcome block without a trigger, and turning it off leaves the document's other parts alone", () => {
    const { doc, id } = createWelcome(SAMPLE, " 어서 오세요 ");
    expect(doc.system).toEqual({ welcome: id });
    expect(doc.scenarios[id]?.trigger).toBeUndefined();
    expect(doc.intents?.[id]).toBeUndefined();
    const reply = doc.scenarios[id]?.steps[0];
    expect(reply && "respond" in reply ? doc.responses[reply.respond] : null).toEqual({ text: "어서 오세요" });
    const off = setWelcome(doc, null);
    expect(off.system).toBeUndefined(); // an emptied system section disappears
    expect(off.scenarios[id]).toBeDefined(); // the block stays: it is a normal block now
    expect(() => setWelcome(SAMPLE, "nope")).toThrow("no scenario nope");
  });

  it("sets escape phrases (trimmed, unique) and its block; no phrases turns it off", () => {
    const on = setEscape(SAMPLE, [" 그만 ", "그만", "", "나가기"], null);
    expect(on.system).toEqual({ escape: { phrases: ["그만", "나가기"] } });
    expect(readSystem(setEscape(on, ["그만"], "greet"))).toMatchObject({ escapePhrases: ["그만"], escapeScenario: "greet" });
    expect(setEscape(on, ["  "], null).system).toBeUndefined();
    expect(() => setEscape(SAMPLE, ["그만"], "nope")).toThrow("no scenario nope");
  });

  it("sets the idle timeout with an optional notice response, and removes the notice when it is cleared", () => {
    const on = setTimeoutNotice(setTimeoutMinutes(SAMPLE, 30), "시간이 지나 처음부터 다시 할게요");
    expect(on.system).toEqual({ timeout: { minutes: 30, notice: TIMEOUT_NOTICE } });
    expect(on.responses[TIMEOUT_NOTICE]).toEqual({ text: "시간이 지나 처음부터 다시 할게요" });
    expect(readSystem(on)).toMatchObject({ timeoutMinutes: 30, timeoutNotice: "시간이 지나 처음부터 다시 할게요" });
    const noNotice = setTimeoutNotice(on, " ");
    expect(noNotice.system).toEqual({ timeout: { minutes: 30 } });
    expect(noNotice.responses[TIMEOUT_NOTICE]).toBeUndefined();
    const off = setTimeoutMinutes(on, null);
    expect(off.system).toBeUndefined();
    expect(off.responses[TIMEOUT_NOTICE]).toBeUndefined();
    const taken = { ...SAMPLE, responses: { ...SAMPLE.responses, [TIMEOUT_NOTICE]: { text: "다른 용도" } } };
    const elsewhere = setTimeoutNotice(setTimeoutMinutes(taken, 10), "안내");
    expect(elsewhere.system?.timeout?.notice).toBe(`${TIMEOUT_NOTICE}_1`); // an existing response is not overwritten
    expect(elsewhere.responses[TIMEOUT_NOTICE]).toEqual({ text: "다른 용도" });
  });

  it.each([0, 1441, 2.5, Number.NaN])("rejects a timeout of %s minutes", (minutes) => {
    expect(() => setTimeoutMinutes(SAMPLE, minutes)).toThrow(RangeError);
  });

  it("sets the re-ask limit within 1-10", () => {
    expect(setMaxAttempts(SAMPLE, 5).settings?.max_attempts).toBe(5);
    expect(readSystem(setMaxAttempts(SAMPLE, 1)).maxAttempts).toBe(1);
    expect(() => setMaxAttempts(SAMPLE, 0)).toThrow(RangeError);
    expect(() => setMaxAttempts(SAMPLE, 11)).toThrow(RangeError);
  });
});
