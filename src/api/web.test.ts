import { describe, expect, it } from "vitest";
import { checkOrigins, MAX_ORIGINS, normalizeOrigin, scriptSnippet, webviewUrl } from "./web";

describe("normalizeOrigin (the engine's rule)", () => {
  it.each([
    ["https://Shop.Example", "https://shop.example"], [" http://localhost:5173 ", "http://localhost:5173"],
    ["https://shop.example:443", "https://shop.example"], ["http://shop.example:80", "http://shop.example"],
    ["https://shop.example:80", "https://shop.example:80"], ["http://[::1]:3000", "http://[::1]:3000"],
    ["http://a.example:00080", "http://a.example:00080"], // as the engine: compared as written
    ["https://xn--9n2bp8q.example", "https://xn--9n2bp8q.example"],
  ])("%j → %j", (given, expected) => expect(normalizeOrigin(given)).toBe(expected));
  it.each(["https://shop.example/", "https://shop.example/a", "ftp://x.example", "shop.example", "https://x.example:0",
           "https://x.example:65536", "null", "", "https://-x.example", "https://user@x.example", "https://샵.example"])("refuses %j", (bad) => {
    expect(normalizeOrigin(bad)).toBeNull();
  });
});

describe("checkOrigins", () => {
  it("normalises one per line, skipping blank lines", () => {
    expect(checkOrigins("https://A.example\n\n  http://b.example:80  \n")).toEqual({ origins: ["https://a.example", "http://b.example"], problems: [] });
    expect(checkOrigins("")).toEqual({ origins: [], problems: [] });
  });
  it("names bad lines, duplicates and too many", () => {
    const r = checkOrigins("https://a.example/path\nhttps://a.example\nHTTPS://A.EXAMPLE");
    expect(r.origins).toEqual(["https://a.example"]);
    expect(r.problems).toEqual(["‘https://a.example/path’은(는) 주소 형식이 아니에요. https://example.com 처럼 경로 없이 써 주세요.",
                                "‘https://a.example’이(가) 두 번 있어요."]);
    const many = Array.from({ length: MAX_ORIGINS + 1 }, (_, i) => `https://s${i}.example`).join("\n");
    expect(checkOrigins(many).problems).toEqual([`허용 도메인은 ${MAX_ORIGINS}개까지예요.`]);
  });
});

describe("snippets", () => {
  it("build the script tag and the webview URL without trailing slashes", () => {
    expect(scriptSnippet("https://w.example/", "https://e.example//", "sample"))
      .toBe('<script src="https://w.example/chatbot.js" data-engine="https://e.example" data-bot="sample" async></script>');
    expect(webviewUrl("https://w.example/chat/", "https://e.example", "sample"))
      .toBe("https://w.example/chat/chat.html?engine=https%3A%2F%2Fe.example&bot=sample&close=1");
  });
  it("escape what would break out of an attribute", () => {
    expect(scriptSnippet('https://w.example/"><b>', "https://e.example", "s")).toContain('src="https://w.example/&quot;>&lt;b>/chatbot.js"');
    expect(scriptSnippet("https://w.example", "https://e.example/?a=1&b=2", "s")).toContain('data-engine="https://e.example/?a=1&amp;b=2"');
  });
});
