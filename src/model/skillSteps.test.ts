// B5: skills a block calls (action steps) and parameter validation by a skill.
import { describe, expect, it } from "vitest";
import sample from "../test/fixtures/sample-bot.json";
import { addSkillStep, readBlock, removeSkillStep, sameDoc, skillSteps, textReply, updateSkillStep, writeBlock } from "./blocks";
import type { BotDoc } from "./doc";

const SAMPLE = sample as unknown as BotDoc;

describe("skill steps", () => {
  it("lists the action steps a block runs, with their arguments", () => {
    expect(skillSteps(readBlock(SAMPLE, "check_weather"))).toEqual([{ index: 1, action: "get_weather", args: { location: "{{ slots.location }}" } }]);
    expect(skillSteps(readBlock(SAMPLE, "greet"))).toEqual([]);
  });

  it("adds a skill after the parameters and before the first reply", () => {
    const weather = addSkillStep(readBlock(SAMPLE, "check_weather"), "get_order"); // collect, action, respond
    expect(weather.steps.map((s) => Object.keys(s)[0])).toEqual(["collect", "action", "action", "respond"]);
    expect(weather.steps[2]).toEqual({ action: "get_order", args: {} });
    const greet = addSkillStep(readBlock(SAMPLE, "greet"), "get_order"); // respond only
    expect(greet.steps[0]).toEqual({ action: "get_order", args: {} });
    const empty = addSkillStep({ ...readBlock(SAMPLE, "greet"), steps: [] }, "x");
    expect(empty.steps).toEqual([{ action: "x", args: {} }]);
  });

  it("changes a step's skill and arguments, and removes it, without touching other steps", () => {
    const block = readBlock(SAMPLE, "check_weather");
    const changed = updateSkillStep(block, 1, "get_temperature", { location: "{{ slots.location }}", unit: "c" });
    expect(changed.steps[1]).toEqual({ action: "get_temperature", args: { location: "{{ slots.location }}", unit: "c" } });
    expect(updateSkillStep(block, 0, "x", {})).toBe(block); // not an action step
    expect(updateSkillStep(block, 9, "x", {})).toBe(block);
    expect(removeSkillStep(block, 1).steps.map((s) => Object.keys(s)[0])).toEqual(["collect", "respond"]);
    expect(removeSkillStep(block, 0)).toBe(block);
    const time = readBlock(SAMPLE, "current_time"); // {action: "now"} without args stays without args
    expect(updateSkillStep(time, 0, "now", {}).steps[0]).toEqual({ action: "now" });
    expect(sameDoc(writeBlock(SAMPLE, updateSkillStep(time, 0, "now", {})), SAMPLE)).toBe(true);
  });
});

describe("parameter validation", () => {
  it("writes validation with its failure message, reads it back, and removes both", () => {
    const block = readBlock(SAMPLE, "check_weather");
    const checked = { ...block, params: block.params.map((p) => ({ ...p, validation: { action: "check_city", fail: textReply("check_weather_location_invalid", "그런 지역은 없어요") } })) };
    const doc = writeBlock(SAMPLE, checked);
    expect(doc.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location",
      validation: { action: "check_city", fail: "check_weather_location_invalid" } });
    expect(doc.responses.check_weather_location_invalid).toEqual({ text: "그런 지역은 없어요" });
    const again = readBlock(doc, "check_weather");
    expect(again.params[0]?.validation?.action).toBe("check_city");
    expect(again.params[0]?.validation?.fail.texts).toEqual(["그런 지역은 없어요"]);
    expect(sameDoc(writeBlock(doc, again), doc)).toBe(true);
    const off = writeBlock(doc, { ...again, params: again.params.map((p) => ({ ...p, validation: null })) });
    expect(off.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location" });
    expect(off.responses.check_weather_location_invalid).toBeUndefined(); // nothing uses it any more
  });
});
