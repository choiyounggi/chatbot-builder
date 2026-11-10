import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotDoc } from "../model/doc";
import sample from "../test/fixtures/sample-bot.json";
import { botEngine, renderAt } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

const save = async () => userEvent.click(screen.getByRole("button", { name: "저장" }));
const saved = (state: ReturnType<typeof botEngine>["state"]) => state.puts.at(-1)?.body as unknown as BotDoc;

describe("scenario and block editor", () => {
  it("lists the blocks, their kind and the intents no block starts with", async () => {
    botEngine();
    renderAt("/bots/sample/scenarios");
    const list = await screen.findByRole("region", { name: "블록 목록" });
    expect(within(list).getByRole("list", { name: "기본 시나리오" }).querySelectorAll("a")).toHaveLength(4);
    expect(within(list).getByRole("list", { name: "블록" }).querySelectorAll("a")).toHaveLength(9);
    expect(within(list).getByRole("link", { name: /날씨 안내.*발화로 시작 · 발화 123/ })).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toContain("out_of_scope · 185개");
    expect(screen.getByText("왼쪽에서 블록을 고르거나 새 블록을 만드세요.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("블록 검색"), "check_weather");
    expect(within(list).getByRole("list", { name: "블록" }).querySelectorAll("a")).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText("블록 검색"));
    await userEvent.type(screen.getByLabelText("블록 검색"), "없는블록");
    expect(within(list).getByText("찾는 블록이 없어요.")).toBeInTheDocument();
  });

  it("creates a block with one example and one reply, opens it, and saves it", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios");
    await userEvent.click(await screen.findByRole("button", { name: "새 블록" }));
    const create = screen.getByRole("button", { name: "블록 만들기" });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("블록 이름", { selector: "#nb-label" }), "쿠폰 안내");
    await userEvent.type(screen.getByLabelText("사용자 발화"), "쿠폰 어디서 받아요");
    await userEvent.type(screen.getByLabelText("봇 응답"), "쿠폰함에서 받아요");
    await userEvent.click(create);
    expect(await screen.findByRole("region", { name: "블록 쿠폰 안내" })).toBeInTheDocument();
    expect(screen.getByLabelText("블록 이름", { selector: "#block-label" })).toHaveFocus();
    expect(screen.getByText(/발화가 5개보다 적으면/)).toBeInTheDocument();
    await save();
    await screen.findByText("저장했어요 · 리비전 5");
    const doc = saved(state);
    expect(doc.scenarios.block_1).toEqual({ label: "쿠폰 안내", trigger: { intent: "block_1" }, steps: [{ respond: "block_1_reply_1" }] });
    expect(doc.intents?.block_1?.examples).toEqual(["쿠폰 어디서 받아요"]);
    expect(doc.responses.block_1_reply_1).toEqual({ text: "쿠폰함에서 받아요" });
  });

  it("edits examples, replies, variants, quick replies and parameters of a block", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/greet");
    const editor = await screen.findByRole("region", { name: /^블록 (?!목록)/ });
    const before = (sample as unknown as BotDoc).intents?.greeting?.examples ?? [];
    await userEvent.type(within(editor).getByLabelText("새 발화"), "오랜만이에요 챗봇아{Enter}");
    await userEvent.click(within(editor).getByRole("button", { name: `발화 "${before[0]}" 삭제` }));
    await userEvent.click(within(editor).getByRole("button", { name: "응답 추가" }));
    const newText = within(editor).getByLabelText("응답 2 문구 1");
    await userEvent.type(newText, "또 오셨네요");
    await userEvent.click(within(editor).getAllByRole("button", { name: "랜덤 문구 추가" })[1] as HTMLElement);
    await userEvent.type(within(editor).getByLabelText("응답 2 문구 2"), "반가워요");
    const addQuick = within(editor).getAllByRole("button", { name: "바로연결 추가" })[1] as HTMLElement;
    await userEvent.click(addQuick);
    await userEvent.type(within(editor).getByLabelText("응답 2 바로연결 1 이름"), "날씨");
    await userEvent.click(addQuick);
    await userEvent.type(within(editor).getByLabelText("응답 2 바로연결 2 이름"), "시간");
    await userEvent.click(within(editor).getByRole("button", { name: "파라미터 추가" }));
    await userEvent.selectOptions(within(editor).getByLabelText("param_1 엔티티"), "sys.time");
    await userEvent.type(within(editor).getByLabelText("param_1 되묻기 질문"), "몇 시에요?");
    await save();
    await screen.findByText("저장했어요 · 리비전 5");
    const doc = saved(state);
    expect(doc.intents?.greeting?.examples).toEqual([...before.slice(1), "오랜만이에요 챗봇아"]);
    expect(doc.responses.greet_reply_1).toEqual({ variants: ["또 오셨네요", "반가워요"], quick_replies: ["날씨", "시간"] });
    expect(doc.scenarios.greet?.slots).toEqual({ param_1: { entity: "sys.time", ask: "greet_ask_1" } });
    expect(doc.scenarios.greet?.steps).toEqual([{ collect: "param_1" }, { respond: "greeting" }, { respond: "greet_reply_1" }]);
    expect(doc.responses.greet_ask_1).toEqual({ text: "몇 시에요?" });
  });

  it("removes replies and unused parameters, and refuses a parameter the block still reads", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/check_weather");
    const editor = await screen.findByRole("region", { name: "블록 날씨 안내" });
    await userEvent.click(within(editor).getByRole("button", { name: "파라미터 location 삭제" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("파라미터 location를 아직 쓰고 있어요: 응답 weather_report, 응답 weather_unavailable, 스킬 get_weather");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled(); // nothing changed
    await userEvent.click(within(editor).getByRole("button", { name: "파라미터 추가" }));
    await userEvent.click(within(editor).getByRole("button", { name: "파라미터 param_1 삭제" }));
    await userEvent.click(within(editor).getByRole("button", { name: "응답 1 삭제" }));
    await save();
    await screen.findByText("저장했어요 · 리비전 5");
    const doc = saved(state);
    expect(doc.scenarios.check_weather?.steps.map((s) => Object.keys(s)[0])).toEqual(["collect", "action"]);
    expect(doc.scenarios.check_weather?.slots).toEqual({ location: { entity: "location", ask: "ask_location" } });
    expect(doc.responses.weather_report).toBeUndefined();
    expect(doc.responses.check_weather_ask_1).toBeUndefined(); // the removed parameter left nothing behind
  });

  it("deletes a block, and refuses while another block calls it", async () => {
    const doc = structuredClone(sample) as unknown as BotDoc;
    doc.scenarios.greet = { ...doc.scenarios.greet, steps: [{ call: "show_help" }] };
    const { state } = botEngine({ doc: doc as unknown as Record<string, unknown> });
    renderAt("/bots/sample/scenarios/show_help");
    await userEvent.click(await screen.findByRole("button", { name: "블록 삭제" }));
    expect(screen.getByRole("alert")).toHaveTextContent("이 블록을 쓰는 곳이 있어요: greet");
    await userEvent.click(screen.getByRole("link", { name: /날씨 안내/ }));
    await userEvent.click(await screen.findByRole("button", { name: "블록 삭제" }));
    expect(await screen.findByText("왼쪽에서 블록을 고르거나 새 블록을 만드세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("블록 검색")).toHaveFocus(); // focus does not fall to the page
    await save();
    await waitFor(() => expect(state.puts).toHaveLength(1));
    expect(saved(state).scenarios.check_weather).toBeUndefined();
    expect(saved(state).intents?.weather).toBeUndefined();
  });

  it("shows an empty editor for an unknown block", async () => {
    botEngine();
    renderAt("/bots/sample/scenarios/nope");
    expect(await screen.findByText("왼쪽에서 블록을 고르거나 새 블록을 만드세요.")).toBeInTheDocument();
  });

  it("shows the run order", async () => {
    botEngine();
    renderAt("/bots/sample/scenarios/check_weather");
    await userEvent.click(await screen.findByText("실행 순서 (고급)"));
    expect(screen.getByText("파라미터 받기: location")).toBeInTheDocument();
    expect(screen.getByText("스킬 실행: get_weather")).toBeInTheDocument();
    expect(screen.getByText("응답: weather_report")).toBeInTheDocument();
  });

  it("explains when the draft cannot be loaded", async () => {
    botEngine({ failDraftAfter: 0 });
    renderAt("/bots/sample/scenarios/nope");
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" }, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe("examples", () => {
  it("ignores an example the block already has", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/greet");
    const editor = await screen.findByRole("region", { name: /^블록 (?!목록)/ });
    await userEvent.type(within(editor).getByLabelText("새 발화"), "방가방가{Enter}");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled(); // nothing changed
    expect(state.puts).toHaveLength(0);
  });
});
