import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeEngine, renderAt, SAMPLE } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

describe("bot list", () => {
  it("shows each bot with its deploy state", async () => {
    fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [
        SAMPLE,
        { ...SAMPLE, id: "shop", label: "", live: "aaaaaaaaaaaa", live_number: 1, undeployed_changes: true },
        { ...SAMPLE, id: "draft_only", label: "새 봇", live: null, live_number: null, serving: null },
      ] } }),
    });
    renderAt("/");
    expect(screen.getByRole("status")).toHaveTextContent("봇 목록을 불러오는 중");
    const link = await screen.findByRole("link", { name: "샘플 봇" });
    expect(link).toHaveAttribute("href", "/bots/sample/settings");
    expect(screen.getByText("배포됨 · v3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "shop" })).toBeInTheDocument(); // no label: the id
    expect(screen.getByText("배포 안 된 변경")).toBeInTheDocument();
    expect(screen.getByText("배포 전 · 초안만 있음")).toBeInTheDocument();
  });

  it("explains how to get a first bot when there is none", async () => {
    fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [] } }) });
    renderAt("/");
    expect(await screen.findByText("아직 봇이 없어요.")).toBeInTheDocument();
  });

  it("says when the engine is not running and retries on request", async () => {
    let up = false;
    fakeEngine({ "GET /v1/builder/bots": () => (up ? { body: { bots: [SAMPLE] } } : "network-error") });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "엔진에 연결할 수 없어요" })).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("link", { name: "샘플 봇" })).toBeInTheDocument();
  });

  it("asks for the admin token on 401, says when it was wrong, and uses the right one", async () => {
    const fetchMock = fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [SAMPLE] } }) }, { token: "s3cret" });
    renderAt("/");
    const input = await screen.findByLabelText("관리자 토큰");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // nothing was sent yet: no "wrong token"
    expect(fetchMock).toHaveBeenCalledTimes(1); // 401 is not retried by itself
    await userEvent.type(input, "wrong");
    await userEvent.click(screen.getByRole("button", { name: "토큰 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("입력한 토큰을 엔진이 받지 않았어요");
    await userEvent.type(screen.getByLabelText("관리자 토큰"), " s3cret ");
    await userEvent.click(screen.getByRole("button", { name: "토큰 저장" }));
    expect(await screen.findByRole("link", { name: "샘플 봇" })).toBeInTheDocument();
  });

  it("refuses tokens that cannot travel in a header", async () => {
    fakeEngine({}, { token: "s3cret" });
    renderAt("/");
    const input = await screen.findByLabelText("관리자 토큰");
    expect(screen.getByRole("button", { name: "토큰 저장" })).toBeDisabled(); // empty
    await userEvent.type(input, "s3cr\u200bet");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/영문·숫자·기호만/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "토큰 저장" })).toBeDisabled();
  });

  it("shows the status for other engine errors", async () => {
    fakeEngine({ "GET /v1/builder/bots": () => ({ status: 503, body: { detail: "temporarily unavailable" } }) });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "엔진 저장소가 잠시 응답하지 않아요" })).toBeInTheDocument();
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
  });
});
