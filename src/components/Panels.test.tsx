import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotDoc } from "../model/doc";
import sample from "../test/fixtures/sample-bot.json";
import { botEngine, renderAt, testTurn } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

const chat = (panel: HTMLElement) => within(within(panel).getByRole("list", { name: "테스트 대화" }));

const open = async (name: "엔티티" | "봇테스트") => {
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.getByRole("complementary", { name });
};

describe("entity panel", () => {
  it("adds a value with synonyms to a dictionary entity and saves it", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/settings");
    const panel = await open("엔티티");
    const location = within(panel).getByRole("region", { name: /엔티티 / });
    await userEvent.type(within(location).getByLabelText("새 대표값"), "가상섬{Enter}");
    await userEvent.type(within(location).getByLabelText("가상섬 동의어"), "가상섬도, 가상섬군");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장했어요 · 리비전 5");
    const doc = state.puts.at(-1)?.body as unknown as BotDoc;
    const values = doc.entities?.location?.kind === "dictionary" ? doc.entities.location.values : {};
    expect(values["가상섬"]).toEqual(["가상섬도", "가상섬군"]);
    expect(Object.keys(values)).toHaveLength(Object.keys((sample as unknown as BotDoc).entities?.location?.kind === "dictionary" ? (sample as unknown as { entities: { location: { values: object } } }).entities.location.values : {}).length + 1);
    expect(within(location).getByRole("button", { name: "추가" })).toBeDisabled(); // empty again
  });

  it("refuses to delete an entity blocks use, and adds and deletes a new one", async () => {
    botEngine();
    renderAt("/bots/sample/settings");
    const panel = await open("엔티티");
    await userEvent.click(within(panel).getByRole("button", { name: /엔티티 .* 삭제/ }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("이 엔티티를 쓰는 블록이 있어요: 날씨 안내, 기온 안내");
    await userEvent.click(within(panel).getByRole("button", { name: "엔티티 추가" }));
    expect(within(panel).getByText("entity_1")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "엔티티 새 엔티티 삭제" }));
    expect(within(panel).queryByText("entity_1")).not.toBeInTheDocument();
    expect(screen.getByText("변경 없음")).toBeInTheDocument();
  });

  it("lists the system entities", async () => {
    botEngine();
    renderAt("/bots/sample/settings");
    const panel = await open("엔티티");
    await userEvent.click(within(panel).getByRole("button", { name: "시스템 엔티티" }));
    expect(within(panel).getByText("sys.number")).toBeInTheDocument();
    expect(within(panel).getByText("sys.time")).toBeInTheDocument();
  });
});

describe("bot test panel", () => {
  it("builds the saved draft on request, then chats with the build and shows what the engine decided", async () => {
    const { state } = botEngine({
      chat: (text, build) => ({ body: testTurn(build, "s", text === "날씨" ? "어느 지역이요?" : `echo: ${text}`, {
        messages: [{ response: "r", text: text === "날씨" ? "어느 지역이요?" : `echo: ${text}`, quick_replies: text === "날씨" ? ["부산"] : [] }],
        stack: text === "날씨" ? [{ scenario: "check_weather", step: 0, awaiting: "location", slots: {} }] : [],
      }) }),
    });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    expect(within(panel).getByText("아직 테스트 빌드가 없어요")).toBeInTheDocument();
    expect(within(panel).getByLabelText("테스트할 발화")).toBeDisabled();
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    expect(await within(panel).findByText("테스트 빌드 b400000 준비됨")).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "날씨{Enter}");
    expect(await chat(panel).findByText("어느 지역이요?")).toBeInTheDocument();
    await userEvent.click(within(panel).getByText("엔진이 판단한 것"));
    expect(within(panel).getByText("check_weather (location 기다림)")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "부산" })); // a quick reply sends its text
    expect(await chat(panel).findByText("echo: 부산")).toBeInTheDocument();
    expect(state.chats.map((c) => c.text)).toEqual(["날씨", "부산"]);
    expect(new Set(state.chats.map((c) => c.session)).size).toBe(1);
  });

  it("keeps the newest line in view: the chat scrolls to the bottom after each reply", async () => {
    botEngine();
    // jsdom has no layout: give every chat list a fixed content height
    const height = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    const list = within(panel).getByRole("list", { name: "테스트 대화" });
    list.scrollTop = 0;
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "안녕{Enter}");
    await chat(panel).findByText("echo: 안녕");
    expect(list.scrollTop).toBe(900);
    height.mockRestore();
  });

  it("switches to the new build after a save and starts a new conversation", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "안녕{Enter}");
    await chat(panel).findByText("echo: 안녕");
    await userEvent.type(screen.getByLabelText("봇 이름"), "!");
    expect(within(panel).getByText("저장 안 된 변경은 테스트에 반영되지 않아요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await within(panel).findByText("새 테스트 빌드로 바꿨어요. 대화를 새로 시작해요.")).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "또{Enter}");
    await chat(panel).findByText("echo: 또");
    expect(state.chats[0]?.build).not.toBe(state.chats[1]?.build);
    expect(state.chats[0]?.session).not.toBe(state.chats[1]?.session);
    // each build opened its own session once; the old session is never opened with the new build
    expect(state.opens.map((o) => `${o.build}:${o.session}`)).toEqual([
      `${state.chats[0]?.build}:${state.chats[0]?.session}`, `${state.chats[1]?.build}:${state.chats[1]?.session}`]);
  });

  it("offers a rebuild when the build expired", async () => {
    const { state } = botEngine({ chat: () => ({ status: 410, body: { detail: "this test build expired; save the draft again" } }) });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "안녕{Enter}");
    expect(await within(panel).findByRole("heading", { name: "테스트 빌드가 만료됐어요" })).toBeInTheDocument();
    await userEvent.click(within(within(panel).getByRole("alert")).getByRole("button", { name: "다시 빌드" }));
    await waitFor(() => expect(state.builds).toBe(2));
  });

  it("explains a failed build", async () => {
    botEngine({ buildFails: true });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    expect(await within(panel).findByText("테스트 빌드 실패: need at least two intents")).toBeInTheDocument();
    expect(within(panel).getByLabelText("테스트할 발화")).toBeDisabled();
  });

  it("opens a new session with the bot's welcome messages, once even under StrictMode's double-invoked effects", async () => {
    const { state } = botEngine({
      open: (build, session) => ({ body: testTurn(build, session, "어서오세요!", { messages: [{ response: "r", text: "어서오세요!", quick_replies: [] }] }) }),
    });
    renderAt("/bots/sample/settings", { strict: true });
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    expect(await chat(panel).findByText("어서오세요!")).toBeInTheDocument();
    expect(state.opens).toHaveLength(1);
  });

  it("shows nothing extra when opening answers messages: [] (an already-open session)", async () => {
    const { state } = botEngine({ open: (build, session) => ({ body: testTurn(build, session, "", { messages: [] }) }) });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    expect(chat(panel).queryAllByRole("listitem")).toHaveLength(0);
    expect(state.opens).toHaveLength(1);
  });

  it("offers a rebuild when opening fails with 410 (an expired build)", async () => {
    const { state } = botEngine({ open: () => ({ status: 410, body: { detail: "this test build expired; save the draft again" } }) });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    expect(await within(panel).findByRole("heading", { name: "테스트 빌드가 만료됐어요" })).toBeInTheDocument();
    await userEvent.click(within(within(panel).getByRole("alert")).getByRole("button", { name: "다시 빌드" }));
    await waitFor(() => expect(state.builds).toBe(2));
  });

  it('sends block_id when a quick reply with action "block" is pressed', async () => {
    const { state } = botEngine({
      chat: (text, build) => ({ body: testTurn(build, "s", `echo: ${text}`, {
        messages: [{
          response: "r", text: `echo: ${text}`, quick_replies: [],
          quick_reply_items: [{ label: "메뉴로", action: "block", message_text: null, block_id: "main_menu" }],
        }],
      }) }),
    });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "안녕{Enter}");
    await userEvent.click(await chat(panel).findByRole("button", { name: "메뉴로" }));
    await waitFor(() => expect(state.chats.at(-1)?.blockId).toBe("main_menu"));
    expect(state.chats.at(-1)?.text).toBe("메뉴로");
  });

  it("removes old lines' buttons once a new test build replaces them", async () => {
    botEngine({
      chat: (text, build) => ({ body: testTurn(build, "s", `echo: ${text}`, { messages: [{ response: "r", text: `echo: ${text}`, quick_replies: ["계속"] }] }) }),
    });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    await within(panel).findByText(/준비됨/);
    await userEvent.type(within(panel).getByLabelText("테스트할 발화"), "안녕{Enter}");
    expect(await chat(panel).findByRole("button", { name: "계속" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("봇 이름"), "!");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await within(panel).findByText("새 테스트 빌드로 바꿨어요. 대화를 새로 시작해요.");
    expect(chat(panel).queryByRole("button", { name: "계속" })).not.toBeInTheDocument();
  });
});


describe("test builds and a restarted engine", () => {
  it("stops following a job the engine forgot", async () => {
    const { state } = botEngine({ jobsForgotten: true });
    renderAt("/bots/sample/settings");
    const panel = await open("봇테스트");
    await userEvent.click(within(panel).getByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    expect(await within(panel).findByText(/테스트 빌드 실패/)).toBeInTheDocument();
    const polls = state.jobPolls;
    await new Promise((r) => setTimeout(r, 1000));
    expect(state.jobPolls).toBe(polls); // no endless polling
  });
});
