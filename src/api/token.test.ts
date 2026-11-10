import { afterEach, describe, expect, it, vi } from "vitest";
import { getToken, isValidToken, setToken } from "./token";

afterEach(() => vi.restoreAllMocks());

describe("admin token", () => {
  it("is stored for this tab and cleared with an empty value", () => {
    expect(getToken()).toBeNull();
    setToken("s3cret");
    expect(getToken()).toBe("s3cret");
    expect(window.sessionStorage.getItem("chatbot-builder.admin-token")).toBe("s3cret");
    setToken("");
    expect(getToken()).toBeNull();
  });

  it("accepts only printable ASCII without spaces", () => {
    expect(isValidToken("A-b_c.9~!")).toBe(true);
    for (const bad of ["", "with space", "zero​width", "“quoted”", "탭"]) expect(isValidToken(bad)).toBe(false);
    setToken("zero​width");
    expect(getToken()).toBeNull(); // never stored
  });

  it("keeps working in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setToken("s3cret")).not.toThrow();
    expect(getToken()).toBe("s3cret");
  });
});
