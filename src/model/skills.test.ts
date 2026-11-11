import { describe, expect, it } from "vitest";
import type { BotDoc } from "./doc";
import {
  addSkill, listSkills, removeSkill, secretNamesIn, SkillInUse, skillUsedBy,
  validateHeaderName, validateHeaderValue, validateSkillId, validateTimeout, validateUrl, writeSkill,
} from "./skills";

const base = (): BotDoc => ({
  id: "sample",
  scenarios: {
    check_weather: {
      label: "날씨 안내",
      trigger: { intent: "weather" },
      slots: { city: { entity: "city", validation: { action: "lookup_city", fail: "틀려요" } } },
      steps: [{ action: "get_forecast", args: {} }, { respond: "r1" }],
    },
    other: { label: "다른 블록", steps: [{ action: "get_forecast", args: {} }] },
  },
  responses: {},
  skills: {
    get_forecast: { url: "https://api.example.com/forecast", timeout_ms: 3000 },
    lookup_city: { label: "도시 확인", url: "https://api.example.com/city", timeout_ms: 3000 },
    unused: { url: "not a url", timeout_ms: 3000 },
  },
});

describe("listSkills", () => {
  it("falls back to the id for a skill without a label, and parses the URL's host", () => {
    const rows = listSkills(base());
    expect(rows.find((r) => r.id === "get_forecast")).toEqual({ id: "get_forecast", label: "get_forecast", host: "api.example.com", usedBy: 2 });
    expect(rows.find((r) => r.id === "lookup_city")).toMatchObject({ label: "도시 확인", usedBy: 1 });
  });

  it("shows an empty host for a URL that does not parse, and counts an unused skill as 0", () => {
    const rows = listSkills(base());
    expect(rows.find((r) => r.id === "unused")).toEqual({ id: "unused", label: "unused", host: "", usedBy: 0 });
  });

  it("is empty for a document with no skills", () => {
    expect(listSkills({ id: "b", scenarios: {}, responses: {} })).toEqual([]);
  });
});

describe("skillUsedBy", () => {
  it("names every block that calls the skill in a step, deduplicated", () => {
    expect(skillUsedBy(base(), "get_forecast")).toEqual(["날씨 안내(check_weather)", "다른 블록(other)"]);
  });

  it("names a block that uses the skill only in a slot's validation", () => {
    expect(skillUsedBy(base(), "lookup_city")).toEqual(["날씨 안내(check_weather)"]);
  });

  it("is empty for a skill nothing calls", () => {
    expect(skillUsedBy(base(), "unused")).toEqual([]);
  });
});

describe("addSkill / removeSkill", () => {
  it("adds a skill with a fresh id, an empty URL and the default timeout", () => {
    const { doc, id } = addSkill(base());
    expect(id).toBe("skill_1");
    expect(doc.skills?.[id]).toEqual({ url: "", timeout_ms: 3000 });
    expect(doc.skills?.get_forecast).toBeDefined(); // the rest of the document is untouched
  });

  it("skips ids already taken", () => {
    const withExtra = { ...base(), skills: { ...base().skills, skill_1: { url: "", timeout_ms: 3000 } } };
    expect(addSkill(withExtra).id).toBe("skill_2");
  });

  it("removes a skill nothing calls", () => {
    const doc = removeSkill(base(), "unused");
    expect(doc.skills?.unused).toBeUndefined();
    expect(Object.keys(doc.skills ?? {})).toEqual(["get_forecast", "lookup_city"]);
  });

  it("refuses to remove a skill in use, naming the blocks", () => {
    expect(() => removeSkill(base(), "get_forecast")).toThrow(SkillInUse);
    try {
      removeSkill(base(), "get_forecast");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillInUse);
      expect((error as SkillInUse).blocks).toEqual(["날씨 안내(check_weather)", "다른 블록(other)"]);
    }
  });
});

describe("writeSkill", () => {
  it("replaces one skill's fields, leaving the others as they were", () => {
    const doc = writeSkill(base(), "unused", { url: "https://fixed.example.com", timeout_ms: 5000 });
    expect(doc.skills?.unused).toEqual({ url: "https://fixed.example.com", timeout_ms: 5000 });
    expect(doc.skills?.get_forecast).toEqual(base().skills?.get_forecast);
  });
});

describe("validateSkillId", () => {
  const doc = base();
  it("accepts a fresh lowercase id", () => expect(validateSkillId("new_skill", doc)).toBeNull());
  it("refuses an empty id", () => expect(validateSkillId("", doc)).toMatch(/입력/));
  it("refuses an id over 64 characters", () => expect(validateSkillId("a".repeat(65), doc)).toMatch(/64자/));
  it("refuses an id not matching the engine's pattern", () => {
    expect(validateSkillId("Skill1", doc)).toMatch(/소문자/);
    expect(validateSkillId("1skill", doc)).toMatch(/소문자/);
  });
  it("refuses a built-in action's id", () => expect(validateSkillId("get_weather", doc)).toMatch(/기본 액션/));
  it("refuses an id another skill already has", () => expect(validateSkillId("get_forecast", doc)).toMatch(/이미/));
});

describe("validateUrl", () => {
  it("accepts http and https addresses", () => {
    expect(validateUrl("https://api.example.com/v1")).toBeNull();
    expect(validateUrl("http://127.0.0.1:8080")).toBeNull();
  });
  it("requires a value by default, but allows blank when not required", () => {
    expect(validateUrl("")).toMatch(/입력/);
    expect(validateUrl("", false)).toBeNull();
  });
  it("refuses non-ASCII addresses", () => expect(validateUrl("https://예시.example.com")).toMatch(/ASCII/));
  it("refuses a malformed address", () => expect(validateUrl("not a url")).toMatch(/공백/));
  it("refuses what has the shape but is not a URL", () => expect(validateUrl("http://[::1")).toMatch(/형식/));
  it("refuses a non-http(s) scheme", () => expect(validateUrl("ftp://example.com")).toMatch(/http/));
});

describe("validateTimeout", () => {
  it("accepts the boundaries and values between them", () => {
    expect(validateTimeout(100)).toBeNull();
    expect(validateTimeout(10_000)).toBeNull();
    expect(validateTimeout(3000)).toBeNull();
  });
  it("refuses values outside 100-10000 and non-integers", () => {
    expect(validateTimeout(99)).toMatch(/100~10000/);
    expect(validateTimeout(10_001)).toMatch(/100~10000/);
    expect(validateTimeout(100.5)).toMatch(/100~10000/);
  });
});

describe("validateHeaderName", () => {
  it("accepts an HTTP token", () => expect(validateHeaderName("X-Api-Key")).toBeNull());
  it("refuses an empty name", () => expect(validateHeaderName("")).toMatch(/입력/));
  it("refuses a name with a space or colon", () => {
    expect(validateHeaderName("X Api")).toMatch(/형식/);
    expect(validateHeaderName("X:Api")).toMatch(/형식/);
  });
});

describe("validateHeaderValue / secretNamesIn", () => {
  it("accepts a plain ASCII value", () => expect(validateHeaderValue("abc123")).toBeNull());
  it("accepts one or more secret templates", () => {
    expect(validateHeaderValue("Bearer {{ secret.API_KEY }}")).toBeNull();
    expect(secretNamesIn("Bearer {{ secret.API_KEY }}")).toEqual(["API_KEY"]);
    expect(secretNamesIn("{{ secret.A }}-{{secret.B}}")).toEqual(["A", "B"]);
  });
  it("accepts an empty value (HTTP allows it)", () => expect(validateHeaderValue("")).toBeNull());
  it("refuses non-ASCII characters", () => expect(validateHeaderValue("값")).toMatch(/ASCII/));
  it("refuses a line break", () => expect(validateHeaderValue("a\nb")).toMatch(/줄바꿈/));
  it("refuses any {{ }} other than a secret template", () => {
    expect(validateHeaderValue("{{ foo }}")).toMatch(/secret/);
    expect(validateHeaderValue("{{ secret.A }")).toMatch(/secret/);
  });
  it("finds no secret names in a value without one", () => expect(secretNamesIn("plain")).toEqual([]));
});
