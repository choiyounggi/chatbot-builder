import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeEngine, headerOf, SAMPLE } from "../test/engine";
import { ApiError, AuthError, ConflictError, EngineUnreachable, getDraft, listBots, saveDraft } from "./client";
import { setToken } from "./token";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("lists bots and sends the admin token when one is set", async () => {
    const fetchMock = fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [SAMPLE] } }) });
    expect(await listBots()).toEqual([SAMPLE]);
    expect(headerOf(fetchMock.mock.calls[0]?.[1], "Authorization")).toBeNull();
    setToken("s3cret");
    await listBots();
    expect(headerOf(fetchMock.mock.calls[1]?.[1], "Authorization")).toBe("Bearer s3cret");
  });

  it("tells an unreachable engine apart from engine errors", async () => {
    fakeEngine({ "GET /v1/builder/bots": () => "network-error" });
    await expect(listBots()).rejects.toBeInstanceOf(EngineUnreachable);
    fakeEngine({ "GET /v1/builder/bots": () => ({ status: 502 }) });
    await expect(listBots()).rejects.toBeInstanceOf(EngineUnreachable);
    fakeEngine({ "GET /v1/builder/bots": () => ({ status: 401, body: { detail: "builder endpoints need the admin token" } }) });
    await expect(listBots()).rejects.toMatchObject({ status: 401, sentToken: false });
    setToken("wrong");
    await expect(listBots()).rejects.toMatchObject({ sentToken: true });
  });

  it("drops a stored token that cannot be sent and asks again", async () => {
    window.sessionStorage.setItem("chatbot-builder.admin-token", "bad\u200btoken"); // stored by an older build
    const fetchMock = fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [] } }) });
    const error = await listBots().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("chatbot-builder.admin-token")).toBeNull();
  });

  it("keeps the engine's list of problems", async () => {
    fakeEngine({ "PUT /v1/builder/bots/sample/draft": () => ({ status: 422, body: { detail: ["the document's id must be 'sample'", 7] } }) });
    await expect(saveDraft("sample", { id: "other" }, '"1"')).rejects.toMatchObject({
      status: 422, problems: ["the document's id must be 'sample'"] });
  });

  it("keeps the engine's message for string details and the status otherwise", async () => {
    fakeEngine({ "GET /v1/builder/bots/nope/draft": () => ({ status: 404, body: { detail: "unknown bot 'nope'" } }) });
    await expect(getDraft("nope")).rejects.toMatchObject({ status: 404, message: "unknown bot 'nope'" });
    fakeEngine({ "GET /v1/builder/bots/x/draft": () => ({ status: 422, body: { detail: [{ msg: "bad" }] } }) });
    await expect(getDraft("x")).rejects.toMatchObject({ status: 422, message: "HTTP 422" });
    fakeEngine({ "GET /v1/builder/bots/x/draft": () => ({ status: 500 }) });
    const error = await getDraft("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(AuthError);
  });

  it("returns the draft with its ETag and refuses a draft without one", async () => {
    fakeEngine({
      "GET /v1/builder/bots/sample/draft": () => ({ body: { id: "sample", label: "샘플" }, headers: { ETag: '"4"' } }),
      "GET /v1/builder/bots/bare/draft": () => ({ body: { id: "bare" } }),
    });
    expect(await getDraft("sample")).toEqual({ document: { id: "sample", label: "샘플" }, etag: '"4"' });
    await expect(getDraft("bare")).rejects.toThrow("without an ETag");
  });

  it("saves with If-Match and turns a 412 into a conflict with the current revision", async () => {
    const saved = { bot: "sample", version: "abc", revision: 5, valid: true, errors: [], warnings: [] };
    const fetchMock = fakeEngine({ "PUT /v1/builder/bots/sample/draft": () => ({ body: saved }) });
    expect(await saveDraft("sample", { id: "sample", label: "새 이름" }, '"4"')).toEqual(saved);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(headerOf(init, "If-Match")).toBe('"4"');
    expect(JSON.parse(String(init?.body))).toEqual({ id: "sample", label: "새 이름" });
    fakeEngine({ "PUT /v1/builder/bots/sample/draft": () => ({ status: 412, body: { detail: "moved", revision: 6 } }) });
    const conflict = await saveDraft("sample", { id: "sample" }, '"4"').catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect((conflict as ConflictError).revision).toBe(6);
    fakeEngine({ "PUT /v1/builder/bots/sample/draft": () => ({ status: 412, body: { detail: "moved" } }) });
    await expect(saveDraft("sample", { id: "sample" }, '"4"')).rejects.toMatchObject({ revision: null });
  });
});
