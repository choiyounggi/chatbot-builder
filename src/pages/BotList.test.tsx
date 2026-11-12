import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeEngine, renderAt, SAMPLE } from "../test/engine";
import { validateBotId } from "./BotList";

afterEach(() => vi.unstubAllGlobals());

const openForm = async () => userEvent.click(await screen.findByRole("button", { name: "새 봇" }));
const fillBase = async (id: string, label: string) => {
  await userEvent.type(screen.getByLabelText("봇 ID"), id);
  await userEvent.type(screen.getByLabelText("이름"), label);
};
const postedBody = (fetchMock: ReturnType<typeof fakeEngine>) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return call ? (JSON.parse(String(call[1]?.body)) as Record<string, unknown>) : null;
};

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

describe("bot id validation", () => {
  it("accepts letters, digits and underscores starting with a lowercase letter", () => {
    expect(validateBotId("shop_1")).toBeNull();
  });

  it("accepts exactly 64 characters and rejects 65 (the engine's boundary)", () => {
    const at64 = `a${"b".repeat(63)}`;
    const at65 = `a${"b".repeat(64)}`;
    expect(at64).toHaveLength(64);
    expect(at65).toHaveLength(65);
    expect(validateBotId(at64)).toBeNull();
    expect(validateBotId(at65)).toBe("64자를 넘을 수 없어요");
  });

  it("rejects an uppercase letter or a leading digit", () => {
    expect(validateBotId("Shop")).toBe("영문 소문자로 시작해야 해요");
    expect(validateBotId("1shop")).toBe("영문 소문자로 시작해야 해요");
  });

  it("rejects a disallowed character", () => {
    expect(validateBotId("my-shop")).toBe("소문자·숫자·밑줄만 쓸 수 있어요");
  });

  it("rejects an empty id", () => {
    expect(validateBotId("")).toBe("영문 소문자로 시작해야 해요");
  });
});

describe("creating a bot", () => {
  it("validates the id on the client and never sends a request for a bad one", async () => {
    const fetchMock = fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [] } }) });
    renderAt("/");
    await openForm();
    await userEvent.type(screen.getByLabelText("봇 ID"), "Bad-Id");
    expect(screen.getByText("영문 소문자로 시작해야 해요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("이름"), "이름");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(postedBody(fetchMock)).toBeNull();
  });

  it("creates an empty bot with the right body and opens it", async () => {
    const fetchMock = fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [] } }),
      "POST /v1/builder/bots": () => ({ status: 201, body: { bot: "shop2", revision: 1 } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("shop2", "샵봇");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(postedBody(fetchMock)).toEqual({ id: "shop2", label: "샵봇" }));
    expect(await screen.findByRole("heading", { name: "설정" })).toBeInTheDocument(); // navigated to the new bot
  });

  it("creates a bot by copying another, sending copy_from", async () => {
    const fetchMock = fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [SAMPLE] } }),
      "POST /v1/builder/bots": () => ({ status: 201, body: { bot: "copybot", revision: 1 } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("copybot", "복사봇");
    await userEvent.click(screen.getByRole("radio", { name: "다른 봇 복사" }));
    await userEvent.selectOptions(screen.getByLabelText("복사할 봇"), "sample");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(postedBody(fetchMock)).toEqual({ id: "copybot", label: "복사봇", copy_from: "sample" }));
  });

  it("explains a 409 (id already exists, including one waiting for deletion)", async () => {
    fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [] } }),
      "POST /v1/builder/bots": () => ({ status: 409, body: { detail: "bot id already exists" } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("dup", "이름");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("이미 있는 ID예요(삭제 대기 중인 봇도 포함)")).toBeInTheDocument();
  });

  it("explains a 404 (the bot to copy has no draft)", async () => {
    fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [SAMPLE] } }),
      "POST /v1/builder/bots": () => ({ status: 404, body: { detail: "copy_from bot has no draft" } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("newid", "이름");
    await userEvent.click(screen.getByRole("radio", { name: "다른 봇 복사" }));
    await userEvent.selectOptions(screen.getByLabelText("복사할 봇"), "sample");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("복사할 봇의 초안이 없어요")).toBeInTheDocument();
  });

  it("shows the engine's 422 message", async () => {
    fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [] } }),
      "POST /v1/builder/bots": () => ({ status: 422, body: { detail: "label must be 1-100 characters" } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("badlabel", "이름");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("label must be 1-100 characters")).toBeInTheDocument();
  });
});

describe("deletion and restore", () => {
  const pending = { ...SAMPLE, id: "gone", label: "지난 봇", deletion: { purge_after: "2026-11-20T03:00:00+00:00" } };

  it("shows a chip and purge time for a bot waiting for deletion, with no link into the editor", async () => {
    fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [pending] } }) });
    renderAt("/");
    expect(await screen.findByText("삭제 대기")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "지난 봇" })).not.toBeInTheDocument();
    expect(screen.getByText("지난 봇")).toBeInTheDocument();
    expect(screen.getByText(/에 영구 삭제/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "되살리기" })).toBeInTheDocument();
  });

  it("restores a bot, refreshes the list, and shows a notice", async () => {
    let restored = false;
    const fetchMock = fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [restored ? { ...SAMPLE, id: "gone", label: "지난 봇" } : pending] } }),
      "POST /v1/builder/bots/gone/restore": () => { restored = true; return { body: { bot: "gone", live: null } }; },
    });
    renderAt("/");
    await userEvent.click(await screen.findByRole("button", { name: "되살리기" }));
    expect(await screen.findByText("‘지난 봇’을(를) 되살렸어요")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "지난 봇" })).toBeInTheDocument(); // refetched: no longer pending
    const restoreCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/gone/restore") && init?.method === "POST");
    expect(restoreCalls).toHaveLength(1);
  });
});


describe("creating a bot: review fixes", () => {
  it("trims the name, refuses a blank one, and stops at 100 characters", async () => {
    const fetchMock = fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [] } }),
      "POST /v1/builder/bots": () => ({ status: 201, body: { bot: "shop3", revision: 1 } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("shop3", "   ");
    expect(screen.getByText("이름을 써 주세요(빈칸만으로는 안 돼요).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
    expect(screen.getByLabelText("이름")).toHaveAttribute("maxLength", "100");
    await userEvent.type(screen.getByLabelText("이름"), "샵봇 ");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(postedBody(fetchMock)).toEqual({ id: "shop3", label: "샵봇" }));
  });

  it("explains the engine's own 422 (a list of field problems) in Korean", async () => {
    fakeEngine({
      "GET /v1/builder/bots": () => ({ body: { bots: [] } }),
      "POST /v1/builder/bots": () => ({ status: 422, body: { detail: [{ type: "string_too_long", loc: ["body", "label"], msg: "String should have at most 100 characters" }] } }),
    });
    renderAt("/");
    await openForm();
    await fillBase("badlabel", "이름");
    await userEvent.click(screen.getByRole("button", { name: "만들기" }));
    expect(await screen.findByText("봇 ID와 이름을 확인해 주세요.")).toBeInTheDocument();
  });
});
