import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, nextTheme, readTheme } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("follows the system until a mode is picked, then remembers it", () => {
    expect(readTheme()).toBe("system");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readTheme()).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("cycles system, light, dark and ignores unknown saved values", () => {
    expect([nextTheme("system"), nextTheme("light"), nextTheme("dark")]).toEqual(["light", "dark", "system"]);
    window.localStorage.setItem("chatbot-builder.theme", "neon");
    expect(readTheme()).toBe("system");
  });

  it("still applies the mode when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(readTheme()).toBe("system");
  });
});
