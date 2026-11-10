// Regressions from the B3 review: each case reproduces a defect found by reading the code.
import { describe, expect, it } from "vitest";
import sample from "../test/fixtures/sample-bot.json";
import { callersOf, deleteBlock, readBlock, sameDoc, writeBlock } from "./blocks";
import { type BotDoc, withRich } from "./doc";
import { readSystem, setTimeoutMinutes, setTimeoutNotice, TIMEOUT_NOTICE } from "./system";

const SAMPLE = sample as unknown as BotDoc;

describe("timeout notice (review #1)", () => {
  const withNotice = (notice: string, response: BotDoc["responses"][string]): BotDoc => ({
    ...structuredClone(SAMPLE), system: { timeout: { minutes: 10, notice } },
    responses: { ...SAMPLE.responses, [notice]: response },
  });

  it("changing only the minutes keeps any notice response as it is", () => {
    for (const response of [{ variants: ["a", "b"] }, { text: "a", quick_replies: ["처음"] }, { simple_image: { image_url: "https://x/a.png", alt_text: "a" } }]) {
      const doc = withNotice("late_notice", response);
      const next = setTimeoutMinutes(doc, 20);
      expect(next.system).toEqual({ timeout: { minutes: 20, notice: "late_notice" } });
      expect(next.responses.late_notice).toEqual(response);
    }
  });

  it("only a plain, unshared text notice is editable here; others are reported read-only", () => {
    expect(readSystem(withNotice("late_notice", { text: "a" })).timeoutNoticeEditable).toBe(true);
    expect(readSystem(withNotice("late_notice", { variants: ["a", "b"] })).timeoutNoticeEditable).toBe(false);
    expect(readSystem(withNotice("restarted", { text: "처음부터" })).timeoutNoticeEditable).toBe(false); // the engine's own
    const shared = withNotice("late_notice", { text: "a" });
    shared.scenarios.greet = { ...shared.scenarios.greet, steps: [{ respond: "late_notice" }] };
    expect(readSystem(shared).timeoutNoticeEditable).toBe(false);
  });

  it("writing the notice text never rewrites a shared response: it gets its own", () => {
    const doc = withNotice("restarted", { text: "처음부터 다시 시작할게요." });
    const next = setTimeoutNotice(doc, "오래 기다려서 처음부터 할게요");
    expect(next.responses.restarted).toEqual({ text: "처음부터 다시 시작할게요." });
    expect(next.system?.timeout).toEqual({ minutes: 10, notice: TIMEOUT_NOTICE });
    expect(next.responses[TIMEOUT_NOTICE]).toEqual({ text: "오래 기다려서 처음부터 할게요" });
  });

  it("keeps the text as typed (a trailing space is part of typing), and blank removes the notice", () => {
    const typed = setTimeoutNotice(setTimeoutMinutes(SAMPLE, 30), "오래 ");
    expect(typed.responses[TIMEOUT_NOTICE]).toEqual({ text: "오래 " });
    const cleared = setTimeoutNotice(typed, "  ");
    expect(cleared.system).toEqual({ timeout: { minutes: 30 } });
    expect(cleared.responses[TIMEOUT_NOTICE]).toBeUndefined();
    expect(() => setTimeoutNotice(SAMPLE, "a")).toThrow("timeout is off");
  });
});

describe("cleanRich keeps what the user has not deleted (review #4, #9)", () => {
  it("an emptied thumbnail address keeps its alt text and link", () => {
    const next = withRich(undefined, "basic_card",
      { title: "t", thumbnail: { image_url: "", alt_text: "로고", link: { web: "https://x" } } }, []);
    expect(next.basic_card?.thumbnail).toEqual({ image_url: "", alt_text: "로고", link: { web: "https://x" } });
    expect(withRich(undefined, "basic_card", { title: "t", thumbnail: { image_url: " " } }, []).basic_card?.thumbnail).toBeUndefined();
  });

  it("explicit nulls in an existing document survive an unrelated edit", () => {
    const doc = structuredClone(SAMPLE);
    doc.scenarios.check_weather = { ...doc.scenarios.check_weather, steps: doc.scenarios.check_weather?.steps ?? [], group: null,
      slots: { location: { entity: "location", ask: "ask_location", default: null } } };
    doc.responses.weather_report = { text: null, basic_card: { title: "t", description: null, thumbnail: { image_url: "https://x/a.png", alt_text: null } } };
    doc.responses.ask_location = { text: "어느 지역이요?", basic_card: null };
    expect(sameDoc(writeBlock(doc, readBlock(doc, "check_weather")), doc)).toBe(true);
  });
});

describe("references (review #5, #8)", () => {
  it("a response used as a validation failure message is not dropped as an orphan", () => {
    const doc = structuredClone(SAMPLE);
    doc.scenarios.check_temperature = { ...doc.scenarios.check_temperature, steps: doc.scenarios.check_temperature?.steps ?? [],
      slots: { location: { entity: "location", ask: "ask_location", validation: { action: "check", fail: "thanks" } } } };
    expect(deleteBlock(doc, "thank").responses.thanks).toEqual(SAMPLE.responses.thanks);
    const thank = readBlock(doc, "thank");
    expect(writeBlock(doc, { ...thank, replies: [], steps: [] }).responses.thanks).toEqual(SAMPLE.responses.thanks);
  });

  it("a block's own button does not stop deleting it, a button elsewhere does", () => {
    const doc = structuredClone(SAMPLE);
    doc.responses.greeting = { text: "안녕", quick_replies: [{ label: "다시", action: "block", block_id: "greet" }] };
    expect(callersOf(doc, "greet")).toEqual([]);
    expect(Object.keys(deleteBlock(doc, "greet").scenarios)).not.toContain("greet");
    doc.scenarios.thank = { ...doc.scenarios.thank, steps: [{ respond: "thanks" }, { respond: "greeting" }] }; // now shared
    expect(callersOf(doc, "greet")).toEqual(["버튼(응답 greeting)"]);
  });
});
