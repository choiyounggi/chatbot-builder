// B3 editing: rich replies, block moves, optional parameters, block groups and the system pages.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotDoc } from "../model/doc";
import sample from "../test/fixtures/sample-bot.json";
import { botEngine, renderAt } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

const save = async () => userEvent.click(screen.getByRole("button", { name: "저장" }));
const saved = (state: ReturnType<typeof botEngine>["state"]) => state.puts.at(-1)?.body as unknown as BotDoc;
const editorOf = () => screen.findByRole("region", { name: /^(블록|기본 시나리오) (?!목록)/ });

async function savedAfter(state: ReturnType<typeof botEngine>["state"], revision = 5) {
  await save();
  await screen.findByText(`저장했어요 · 리비전 ${revision}`);
  return saved(state);
}

describe("rich replies", () => {
  it("turns a text reply into a card with a block button and saves Kakao's fields", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/thank");
    const editor = await editorOf();
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 형식"), "basic_card");
    expect(window.confirm).toHaveBeenCalledOnce(); // the old text would be lost
    await userEvent.type(within(editor).getByLabelText("응답 1 제목"), "도움이 됐다니 다행이에요");
    await userEvent.type(within(editor).getByLabelText("응답 1 썸네일 이미지 주소"), "https://example.com/t.png");
    await userEvent.click(within(editor).getByRole("button", { name: "버튼 추가" }));
    await userEvent.type(within(editor).getByLabelText("응답 1 버튼 1 이름"), "도움말 보기");
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 버튼 1 동작"), "block");
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 버튼 1 이동할 블록"), "show_help");
    const doc = await savedAfter(state);
    expect(doc.responses.thanks).toEqual({ basic_card: {
      title: "도움이 됐다니 다행이에요", thumbnail: { image_url: "https://example.com/t.png" },
      buttons: [{ label: "도움말 보기", action: "block", block_id: "show_help" }],
    } });
  });

  it("keeps the reply when switching kind is not confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    botEngine();
    renderAt("/bots/sample/scenarios/thank");
    const editor = await editorOf();
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 형식"), "simple_image");
    expect(within(editor).getByLabelText("응답 1 형식")).toHaveValue("text");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled(); // nothing changed
  });

  it("edits an image, a list and a carousel", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/greet");
    const editor = await editorOf();
    await userEvent.click(within(editor).getByRole("button", { name: "응답 추가" }));
    await userEvent.click(within(editor).getByRole("button", { name: "응답 추가" }));
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 형식"), "simple_image");
    await userEvent.type(within(editor).getByLabelText("응답 1 이미지 주소"), "https://example.com/hi.png");
    await userEvent.type(within(editor).getByLabelText("응답 1 대체 텍스트"), "손 흔드는 그림");
    await userEvent.selectOptions(within(editor).getByLabelText("응답 2 형식"), "list_card");
    await userEvent.type(within(editor).getByLabelText("응답 2 리스트 제목"), "할 수 있는 일");
    await userEvent.type(within(editor).getByLabelText("응답 2 항목 1 제목"), "날씨");
    await userEvent.click(within(editor).getByRole("button", { name: "항목 추가" }));
    await userEvent.type(within(editor).getByLabelText("응답 2 항목 2 제목"), "시각");
    await userEvent.type(within(editor).getByLabelText("응답 2 항목 2 링크"), "https://time.example");
    await userEvent.selectOptions(within(editor).getByLabelText("응답 3 형식"), "carousel");
    await userEvent.type(within(editor).getByLabelText("응답 3 카드 1 제목"), "첫 장");
    await userEvent.click(within(editor).getByRole("button", { name: "카드 추가" }));
    await userEvent.type(within(editor).getByLabelText("응답 3 카드 2 설명"), "둘째 장");
    await userEvent.click(within(editor).getByRole("button", { name: "응답 3 카드 1 삭제" }));
    const doc = await savedAfter(state);
    expect(doc.responses.greeting).toEqual({ simple_image: { image_url: "https://example.com/hi.png", alt_text: "손 흔드는 그림" } });
    expect(doc.responses.greet_reply_1).toEqual({ list_card: { header: { title: "할 수 있는 일" }, buttons: [],
      items: [{ title: "날씨" }, { title: "시각", link: { web: "https://time.example" } }] } });
    expect(doc.responses.greet_reply_2).toEqual({ carousel: { type: "basic_card", items: [{ description: "둘째 장", buttons: [] }] } });
  });

  it("adds a quick reply that moves to a block, and warns about Kakao's limits", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/show_help");
    const editor = await editorOf();
    await userEvent.click(within(editor).getByRole("button", { name: "바로연결 추가" }));
    await userEvent.type(within(editor).getByLabelText("응답 1 바로연결 1 이름"), "지금 몇 시예요 알려주세요 꼭");
    expect(within(editor).getByText(/14자까지만 보여요: 지금 몇 시예요/)).toBeInTheDocument();
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 바로연결 1 동작"), "block");
    await userEvent.selectOptions(within(editor).getByLabelText("응답 1 바로연결 1 이동할 블록"), "current_time");
    for (let i = 0; i < 3; i++) await userEvent.click(within(editor).getByRole("button", { name: "응답 추가" }));
    expect(within(editor).getByText(/말풍선을 3개까지만/)).toBeInTheDocument();
    for (let i = 0; i < 3; i++) await userEvent.click(within(editor).getByRole("button", { name: `응답 ${4 - i} 삭제` }));
    const doc = await savedAfter(state);
    expect(doc.responses.help?.quick_replies).toEqual([{ label: "지금 몇 시예요 알려주세요 꼭", action: "block", block_id: "current_time" }]);
  });

  it("refuses to delete a block a button moves to", async () => {
    const doc = structuredClone(sample) as unknown as BotDoc;
    doc.responses.help = { text: "도움말", quick_replies: [{ label: "인사", action: "block", block_id: "greet" }] };
    botEngine({ doc: doc as unknown as Record<string, unknown> });
    renderAt("/bots/sample/scenarios/greet");
    await userEvent.click(await screen.findByRole("button", { name: "블록 삭제" }));
    expect(screen.getByRole("alert")).toHaveTextContent("이 블록을 쓰는 곳이 있어요: 버튼(응답 help)");
  });
});

describe("parameters and groups", () => {
  it("makes a parameter optional with a default, and required again", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/check_weather");
    const editor = await editorOf();
    await userEvent.click(within(editor).getByLabelText("location 필수"));
    await userEvent.type(within(editor).getByLabelText("location 기본값"), "서울");
    let doc = await savedAfter(state);
    expect(doc.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location", required: false, default: "서울" });
    await userEvent.click(within(editor).getByLabelText("location 필수"));
    expect(within(editor).getByLabelText("location 되묻기 질문")).toHaveValue("어느 지역이요?");
    doc = await savedAfter(state, 6);
    expect(doc.scenarios.check_weather?.slots?.location).toEqual({ entity: "location", ask: "ask_location", required: true });
  });

  it("gives a parameter without a question one when it becomes required", async () => {
    const doc = structuredClone(sample) as unknown as BotDoc;
    doc.scenarios.greet = { ...doc.scenarios.greet, steps: doc.scenarios.greet?.steps ?? [],
      slots: { who: { entity: "sys.text", required: false } } };
    const { state } = botEngine({ doc: doc as unknown as Record<string, unknown> });
    renderAt("/bots/sample/scenarios/greet");
    const editor = await editorOf();
    await userEvent.click(within(editor).getByLabelText("who 필수"));
    await userEvent.type(within(editor).getByLabelText("who 되묻기 질문"), "누구세요?");
    const after = await savedAfter(state);
    expect(after.scenarios.greet?.slots?.who).toEqual({ entity: "sys.text", required: true, ask: "greet_ask_who" });
    expect(after.responses.greet_ask_who).toEqual({ text: "누구세요?" });
  });

  it("puts blocks in groups shown as headings, and finds them by group", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/greet");
    const editor = await editorOf();
    await userEvent.type(within(editor).getByLabelText("블록 묶음"), "첫 만남");
    const list = screen.getByRole("region", { name: "블록 목록" });
    expect(within(list).getByRole("heading", { name: "첫 만남" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "묶음 없음" })).toBeInTheDocument();
    expect(within(list).getByRole("list", { name: "블록 묶음 첫 만남" })).toHaveTextContent("인사");
    await userEvent.type(screen.getByLabelText("블록 검색"), "첫 만남"); // found by its group alone
    expect(within(list).queryByRole("list", { name: "블록" })).toBeNull();
    expect(within(list).queryByRole("heading", { name: "묶음 없음" })).toBeNull(); // one group: no "none" heading
    const doc = await savedAfter(state);
    expect(doc.scenarios.greet?.group).toBe("첫 만남");
  });
});

describe("기본 시나리오", () => {
  it("turns the welcome block on, edits it, and turns it off again", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/_welcome");
    const page = await editorOf();
    await userEvent.click(within(page).getByLabelText("웰컴 블록 사용"));
    const text = within(page).getByLabelText("응답 1 문구 1");
    expect(text).toHaveValue("안녕하세요! 무엇을 도와드릴까요?");
    await userEvent.clear(text);
    await userEvent.type(text, "어서 오세요");
    let doc = await savedAfter(state);
    expect(doc.system).toEqual({ welcome: "block_1" });
    expect(doc.scenarios.block_1).toEqual({ label: "웰컴", steps: [{ respond: "block_1_reply_1" }] });
    expect(doc.responses.block_1_reply_1).toEqual({ text: "어서 오세요" });
    expect(within(screen.getByRole("region", { name: "블록 목록" })).queryByRole("link", { name: /^웰컴 발화/ })).toBeNull();
    await userEvent.click(within(page).getByLabelText("웰컴 블록 사용"));
    doc = await savedAfter(state, 6);
    expect(doc.system).toBeUndefined();
    expect(doc.scenarios.block_1).toBeDefined(); // kept as a normal block
  });

  it("edits the fallback texts and the out-of-scope examples", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/_fallback");
    const page = await editorOf();
    expect(within(page).queryByLabelText("응답 1 형식")).toBeNull(); // text only
    await userEvent.click(within(page).getByRole("button", { name: "랜덤 문구 추가" }));
    await userEvent.type(within(page).getByLabelText("응답 1 문구 2"), "다르게 말해 주시겠어요?");
    await userEvent.type(within(page).getByLabelText("새 모르는 질문"), "양자컴퓨터 하나 사줘{Enter}");
    const doc = await savedAfter(state);
    expect(doc.responses.fallback?.variants).toEqual([(sample as unknown as BotDoc).responses.fallback?.text, "다르게 말해 주시겠어요?"]);
    expect(doc.intents?.out_of_scope?.examples.at(-1)).toBe("양자컴퓨터 하나 사줘");
  });

  it("sets escape phrases and the block run afterwards", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/_escape");
    const page = await editorOf();
    expect(within(page).queryByLabelText("끝낸 뒤 실행할 블록")).toBeNull();
    await userEvent.type(within(page).getByLabelText("새 탈출 문구"), "나가기{Enter}");
    await userEvent.type(within(page).getByLabelText("새 탈출 문구"), "나가기{Enter}"); // already there
    await userEvent.type(within(page).getByLabelText("응답 1 문구 1"), " 다음에 또 불러 주세요.");
    let doc = await savedAfter(state);
    expect(doc.system).toEqual({ escape: { phrases: ["나가기"] } });
    expect(doc.responses.cancelled?.text).toMatch(/다음에 또 불러 주세요\.$/);
    await userEvent.selectOptions(within(page).getByLabelText("끝낸 뒤 실행할 블록"), "show_help");
    expect(within(page).queryByLabelText("응답 1 문구 1")).toBeNull();
    await userEvent.click(within(page).getByRole("button", { name: '"나가기" 삭제' }));
    doc = await savedAfter(state, 6);
    expect(doc.system).toBeUndefined(); // no phrases: escape is off
  });

  it("sets the re-ask limit and the idle timeout with its notice", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/scenarios/_settings");
    const page = await editorOf();
    await userEvent.selectOptions(within(page).getByLabelText("되묻기 최대 횟수"), "5");
    expect(within(page).queryByLabelText("대기 시간(분)")).toBeNull();
    await userEvent.click(within(page).getByLabelText("대기 시간이 지나면 처음부터"));
    const minutes = within(page).getByLabelText("대기 시간(분)");
    expect(minutes).toHaveValue(30);
    await userEvent.clear(minutes); // blank is not saved: the last valid value stays, with a hint
    expect(within(page).getByText(/1~1440 사이의 정수를 넣어 주세요. 지금은 30분으로 저장돼요/)).toBeInTheDocument();
    await userEvent.type(minutes, "15");
    await userEvent.type(within(page).getByLabelText("시간 초과 안내"), "오래 기다려서 처음부터 할게요");
    let doc = await savedAfter(state);
    expect(doc.settings?.max_attempts).toBe(5);
    expect(doc.system).toEqual({ timeout: { minutes: 15, notice: "timeout_notice" } });
    expect(doc.responses.timeout_notice).toEqual({ text: "오래 기다려서 처음부터 할게요" });
    await userEvent.click(within(page).getByLabelText("대기 시간이 지나면 처음부터"));
    doc = await savedAfter(state, 6);
    expect(doc.system).toBeUndefined();
    expect(doc.responses.timeout_notice).toBeUndefined();
  });

  it("lists the four system pages and opens each", async () => {
    botEngine();
    renderAt("/bots/sample/scenarios");
    const list = await screen.findByRole("list", { name: "기본 시나리오" });
    expect(within(list).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "웰컴대화를 열면", "폴백못 알아들으면", "탈출진행 중인 대화 끝내기", "시나리오 설정되묻기·대기 시간"]);
    await userEvent.click(within(list).getByRole("link", { name: /폴백/ }));
    expect(await screen.findByRole("region", { name: "기본 시나리오 폴백" })).toBeInTheDocument();
  });
});
