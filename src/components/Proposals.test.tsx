// B10: LLM-proposed sentences, screened by the engine, added after a person looks (engine E-H).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { fakeEngine, type Reply } from "../test/engine";
import { Proposals } from "./Proposals";

afterEach(() => vi.unstubAllGlobals());

const ITEMS = [
  { text: "날시 알려줘", type: "typo", status: "ok", detail: "" },
  { text: "날씨 어떰", type: "casual", status: "ok", detail: "" },
  { text: "오늘 날씨 알려줘", type: "paraphrase", status: "duplicate", detail: "이미 있는 문장이에요" },
  { text: "{city} 날씨", type: "synonym", status: "invalid", detail: "원래 예문에 없는 {자리} 표시가 있어요" },
  { text: "지금 몇 시야", type: "paraphrase", status: "conflict", detail: "‘현재 시각’ 블록으로 판단돼요 (0.91)" },
];

function setup(reply: Reply = { body: { bot: "sample", kind: "intent", id: "weather", model: "qwen3-14b", ms: 8400, items: ITEMS } },
               blocked: string | null = null) {
  const bodies: unknown[] = [];
  fakeEngine({
    "POST /v1/builder/bots/sample/augment": (init) => { bodies.push(JSON.parse(String(init.body))); return reply; },
  });
  const onAdd = vi.fn();
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  render(<Providers client={client}><MemoryRouter>
    <Proposals botId="sample" kind="intent" target="weather" what="발화" blocked={blocked} onAdd={onAdd} />
  </MemoryRouter></Providers>);
  return { bodies, onAdd };
}

describe("Proposals", () => {
  it("asks for the chosen count, checks the recommended ones, and adds what is checked", async () => {
    const { bodies, onAdd } = setup();
    await userEvent.selectOptions(screen.getByLabelText("개수"), "40");
    await userEvent.click(screen.getByRole("button", { name: "LLM으로 발화 더 만들기" }));
    expect(bodies).toEqual([{ kind: "intent", id: "weather", count: 40 }]);
    const list = await screen.findByRole("list", { name: "LLM이 만든 발화" });
    expect(screen.getByRole("status")).toHaveTextContent("qwen3-14b · 8.4초 · 5개 중 2개를 추천해요");
    const box = (text: string) => within(list).getByText(text).closest("label")?.querySelector("input") as HTMLInputElement;
    expect(box("날시 알려줘")).toBeChecked();
    expect(box("오늘 날씨 알려줘")).toBeDisabled();
    expect(box("{city} 날씨")).toBeDisabled();
    expect(box("지금 몇 시야")).not.toBeChecked();
    expect(box("지금 몇 시야")).toBeEnabled(); // a person may still keep it
    expect(within(list).getByText("헷갈려요: ‘현재 시각’ 블록으로 판단돼요 (0.91)")).toBeInTheDocument();
    expect(within(list).getByText("오타")).toBeInTheDocument();
    await userEvent.click(box("날씨 어떰"));
    await userEvent.click(box("지금 몇 시야"));
    await userEvent.click(screen.getByRole("button", { name: "선택한 2개 추가" }));
    expect(onAdd).toHaveBeenCalledWith(["날시 알려줘", "지금 몇 시야"]);
    expect(screen.queryByRole("list", { name: "LLM이 만든 발화" })).not.toBeInTheDocument();
  });

  it("cannot run while blocked, and says why", () => {
    setup(undefined, "먼저 저장해 주세요");
    expect(screen.getByRole("button", { name: "LLM으로 발화 더 만들기" })).toBeDisabled();
    expect(screen.getByText("먼저 저장해 주세요")).toBeInTheDocument();
  });

  it.each([
    [409, "this server has no LLM", "엔진에 LLM이 연결되어 있지 않아요"],
    [404, "the saved draft has no block 'weather'", "저장된 내용에 아직 없어요"],
    [424, "the LLM did not answer: timeout: no answer within 90s", "LLM이 답하지 않았어요 (timeout: no answer within 90s). 다시 해 보세요."],
  ])("an engine %i says what to do", async (status, detail, text) => {
    setup({ status, body: { detail } });
    await userEvent.click(screen.getByRole("button", { name: "LLM으로 발화 더 만들기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("an engine without the route (an older one) is not told to save first", async () => {
    setup({ status: 404, body: { detail: "Not Found" } });
    await userEvent.click(screen.getByRole("button", { name: "LLM으로 발화 더 만들기" }));
    expect(await screen.findByText(/봇이 없거나 아직 초안이 없어요/)).toBeInTheDocument();
    expect(screen.queryByText(/먼저 저장해 주세요/)).not.toBeInTheDocument();
  });

  it("says it is working, links each warning to its checkbox, and gives focus back after adding", async () => {
    setup();
    const start = screen.getByRole("button", { name: "LLM으로 발화 더 만들기" });
    await userEvent.click(start);
    const list = await screen.findByRole("list", { name: "LLM이 만든 발화" });
    const conflictBox = within(list).getByText("지금 몇 시야").closest("label")?.querySelector("input") as HTMLInputElement;
    expect(conflictBox).toHaveAccessibleDescription(/헷갈려요: ‘현재 시각’ 블록으로 판단돼요/);
    await userEvent.click(screen.getByRole("button", { name: "선택한 2개 추가" }));
    expect(start).toHaveFocus();
  });

  it("does not add more than there is room for", async () => {
    const onAdd = vi.fn();
    fakeEngine({ "POST /v1/builder/bots/sample/augment": () => ({ body: { bot: "sample", kind: "faq", id: "f", model: "m", ms: 1, items: ITEMS } }) });
    const client = createQueryClient();
    render(<Providers client={client}><MemoryRouter>
      <Proposals botId="sample" kind="faq" target="f" what="비슷한 질문" scope="FAQ 2" room={1} blocked={null} onAdd={onAdd} />
    </MemoryRouter></Providers>);
    await userEvent.click(screen.getByRole("button", { name: "FAQ 2 LLM으로 비슷한 질문 더 만들기" }));
    expect(await screen.findByText("1개까지 더 넣을 수 있어요. 선택을 줄여 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "선택한 2개 추가" })).toBeDisabled();
    expect(screen.getByLabelText("FAQ 2 개수")).toBeInTheDocument();
  });

  it("an answer with no sentences says so and closes", async () => {
    setup({ body: { bot: "sample", kind: "intent", id: "weather", model: "m", ms: 10, items: [] } });
    await userEvent.click(screen.getByRole("button", { name: "LLM으로 발화 더 만들기" }));
    expect(await screen.findByText("만든 문장이 없어요. 다시 해 보세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "선택한 0개 추가" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByText("만든 문장이 없어요. 다시 해 보세요.")).not.toBeInTheDocument());
  });
});
