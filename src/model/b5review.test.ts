// Regressions from the B5 review (each reproduces a finding).
import { describe, expect, it } from "vitest";
import sample from "../test/fixtures/sample-bot.json";
import { paramUses, readBlock, resultUses, textReply } from "./blocks";
import type { BotDoc } from "./doc";
import { skillUsedBy, validateHeaderValue, validateUrl } from "./skills";

const SAMPLE = sample as unknown as BotDoc;

describe("engine-equal URL rules (#2)", () => {
  it.each(["http:/example.com", "https:example.com", "http:///x", "https://a.com/a b", "https://a.com ", `https://a.com/${"x".repeat(2000)}`,
    "https://a.com:99999/x"])("refuses %s like the engine", (url) => {
    expect(validateUrl(url)).not.toBeNull();
  });
  it("accepts what the engine accepts", () => {
    expect(validateUrl("https://shop.example:8443/order?x=1")).toBeNull();
    expect(validateUrl("", false)).toBeNull();
  });
  it("refuses a NUL in a header value (#9)", () => {
    expect(validateHeaderValue("a\0b")).not.toBeNull();
    expect(validateHeaderValue("")).toBeNull(); // the engine allows an empty value
  });
});

describe("usage by block id (#5)", () => {
  it("counts two blocks with the same label as two", () => {
    const doc = structuredClone(SAMPLE);
    doc.scenarios.greet = { ...doc.scenarios.greet, label: "같은 이름", steps: [{ action: "s" }, { respond: "greeting" }] };
    doc.scenarios.thank = { ...doc.scenarios.thank, label: "같은 이름", steps: [{ action: "s" }, { respond: "thanks" }] };
    expect(skillUsedBy(doc, "s")).toEqual(["같은 이름(greet)", "같은 이름(thank)"]);
  });
});

describe("references a block still reads (#4, #6)", () => {
  it("finds replies and branches that read a skill's results", () => {
    const doc = structuredClone(SAMPLE);
    expect(resultUses(doc, readBlock(doc, "check_weather"), "get_weather")).toEqual(["응답 weather_report"]);
    expect(resultUses(doc, readBlock(doc, "check_weather"), "now")).toEqual([]);
    doc.scenarios.greet = { ...doc.scenarios.greet, steps: [{ action: "x" }, { branch: { on: "results.x.ok", cases: { true: "thank" } } }] };
    expect(resultUses(doc, readBlock(doc, "greet"), "x")).toEqual(["분기"]);
  });
  it("counts another parameter's validation message as a use of a parameter", () => {
    const doc = structuredClone(SAMPLE);
    doc.responses.city_bad = { text: "{{ slots.location }}은 안 돼요" };
    const block = readBlock(doc, "check_weather");
    const withB = { ...block, params: [...block.params, { name: "b", entity: "sys.text", ask: textReply("q"), required: true, default: null,
      validation: { action: "x", fail: { ...textReply("city_bad"), texts: ["{{ slots.location }}은 안 돼요"] } } }] };
    expect(paramUses(doc, withB, "location")).toContain("응답 city_bad");
  });
});
