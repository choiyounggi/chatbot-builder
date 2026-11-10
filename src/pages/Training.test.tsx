// B4: the training queue (학습대기 / 학습이력) and the ML settings (머신러닝).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confusableOf } from "../draft/DraftContext";
import type { BotDoc } from "../model/doc";
import { classifierIntents, setExactOnly, setKeywordMatch, setLevel } from "../model/ml";
import sample from "../test/fixtures/sample-bot.json";
import { botEngine, headerOf, renderAt, type Reply } from "../test/engine";
import { periodStart } from "./Training";

afterEach(() => vi.unstubAllGlobals());

const SAMPLE = sample as unknown as BotDoc;
const B = "/v1/builder/bots/sample";
const item = (text: string, extra: Record<string, unknown> = {}) => ({
  key: text, text, count: 3, sessions: 2, first_seen: "2026-11-09T01:00:00+00:00", last_seen: "2026-11-10T02:00:00+00:00",
  rule: "fallback", intent: "weather", score: 0.41, status: "pending", status_intent: null, ...extra,
});

/** A queue that remembers what the builder did, like the engine. */
function queueEngine(options: { addReply?: Reply; truncated?: boolean } = {}) {
  const asked: URLSearchParams[] = [];
  const posts: { path: string; body: unknown; ifMatch: string | null }[] = [];
  const status = new Map<string, string>();
  const engine = botEngine({
    extra: {
      [`GET ${B}/utterances`]: (init) => {
        const params = new URL(init.url, "http://x").searchParams;
        asked.push(params);
        const items = [item("양자컴퓨터로 날씨 예측해줘"), item("주식 추천", { intent: "help", score: null, count: 1 })]
          .map((i) => ({ ...i, status: status.get(i.text) ?? "pending" }))
          .filter((i) => params.get("status") === "all" || i.status === params.get("status"));
        return { body: { bot: "sample", scanned: 20000, truncated: options.truncated ?? false, items } };
      },
      [`POST ${B}/utterances/add`]: (init) => {
        const body = JSON.parse(String(init.body)) as { texts: string[] };
        posts.push({ path: "add", body, ifMatch: headerOf(init, "If-Match") });
        if (options.addReply) return options.addReply;
        for (const t of body.texts) status.set(t, "added");
        return { body: { bot: "sample", version: null, revision: 5, valid: true, errors: [], warnings: [] }, headers: { ETag: '"5"' } };
      },
      [`POST ${B}/utterances/ignore`]: (init) => {
        const body = JSON.parse(String(init.body)) as { texts: string[] };
        posts.push({ path: "ignore", body, ifMatch: null });
        for (const t of body.texts) status.set(t, "ignored");
        return { body: { bot: "sample", marked: body.texts.length } };
      },
      [`POST ${B}/utterances/restore`]: (init) => {
        const body = JSON.parse(String(init.body)) as { texts: string[] };
        posts.push({ path: "restore", body, ifMatch: null });
        for (const t of body.texts) status.set(t, "pending");
        return { body: { bot: "sample", marked: body.texts.length } };
      },
      [`GET ${B}/utterances/marks`]: () => ({ body: { bot: "sample", items: [
        { key: "a", text: "양자컴퓨터로 날씨 예측해줘", status: "added", intent: "weather", marked_at: "2026-11-10T03:00:00+00:00" },
        { key: "b", text: "주식 추천", status: "ignored", intent: null, marked_at: "2026-11-10T02:00:00+00:00" },
        { key: "b", text: "주식 추천", status: "pending", intent: null, marked_at: "2026-11-10T01:00:00+00:00" }] } }),
    },
  });
  return { ...engine, asked, posts };
}

describe("학습대기", () => {
  it("lists misunderstood sentences of the last 7 days and adds one to the block it was closest to", async () => {
    const { asked, posts, state } = queueEngine();
    renderAt("/bots/sample/training");
    const first = (await screen.findByText("양자컴퓨터로 날씨 예측해줘")).closest("li") as HTMLElement;
    expect(within(first).getByText(/3회 · 세션 2 · .* · 못 알아들음 · 가장 가까운 블록 날씨 안내 41%/)).toBeInTheDocument();
    const params = asked[0] as URLSearchParams;
    expect([params.get("rule"), params.get("status"), params.get("intent")]).toEqual(["misunderstood", "pending", null]);
    expect(new Date(params.get("since") as string).getTime()).toBe(new Date(periodStart(7) as string).getTime());
    expect(within(first).getByLabelText(/을 넣을 블록/)).toHaveValue("weather"); // the closest block is preselected
    await userEvent.click(within(first).getByRole("button", { name: "예문으로 추가" }));
    expect(await screen.findByText(/‘양자컴퓨터로 날씨 예측해줘’을 ‘날씨 안내’의 예문으로 넣었어요/)).toBeInTheDocument();
    expect(posts[0]).toEqual({ path: "add", body: { texts: ["양자컴퓨터로 날씨 예측해줘"], intent: "weather" }, ifMatch: `"${state.revision}"` });
    await waitFor(() => expect(screen.queryByText("양자컴퓨터로 날씨 예측해줘")).toBeNull()); // no longer pending
  });

  it("does not preselect 모르는 질문 for a sentence closest to it", async () => {
    botEngine({ extra: { [`GET ${B}/utterances`]: () => ({ body: { bot: "sample", scanned: 1, truncated: false,
      items: [item("오늘 저녁 메뉴 골라줘", { intent: "out_of_scope", score: 0.68 })] } }) } });
    renderAt("/bots/sample/training");
    const row = (await screen.findByText("오늘 저녁 메뉴 골라줘")).closest("li") as HTMLElement;
    await within(row).findByText(/모르는 질문\(폴백\) 68%/); // the targets are loaded
    expect(within(row).getByLabelText(/을 넣을 블록/)).toHaveValue("");
    expect(within(row).getByRole("button", { name: "예문으로 추가" })).toBeDisabled();
  });

  it("filters by period, rule, block and status", async () => {
    const { asked } = queueEngine();
    renderAt("/bots/sample/training");
    await screen.findByText("주식 추천");
    const second = screen.getByText("주식 추천").closest("li") as HTMLElement;
    expect(within(second).getByLabelText(/을 넣을 블록/)).toHaveValue("help"); // the closest block is a trigger block: preselected
    await userEvent.selectOptions(screen.getByLabelText("기간"), "all");
    await userEvent.selectOptions(screen.getByLabelText("보기"), "all");
    await userEvent.selectOptions(screen.getByLabelText("블록"), "weather");
    await userEvent.selectOptions(screen.getByLabelText("상태"), "all");
    await waitFor(() => expect(asked.at(-1)?.get("status")).toBe("all"));
    const last = asked.at(-1) as URLSearchParams;
    expect([last.get("since"), last.get("rule"), last.get("intent")]).toEqual([null, "all", "weather"]);
  });

  it("ignores a sentence and restores it", async () => {
    const { posts } = queueEngine();
    renderAt("/bots/sample/training");
    const row = (await screen.findByText("주식 추천")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "무시" }));
    await waitFor(() => expect(screen.queryAllByText("주식 추천", { selector: ".queue-text" })).toHaveLength(0));
    expect(screen.getByText("‘주식 추천’을 무시했어요.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("상태"), "ignored");
    const ignored = (await screen.findByText("무시한 말이에요.")).closest("li") as HTMLElement;
    await userEvent.click(within(ignored).getByRole("button", { name: "되돌리기" }));
    await waitFor(() => expect(posts.map((p) => p.path)).toEqual(["ignore", "restore"]));
  });

  it("needs the draft without unsaved changes, and explains a sentence another block owns", async () => {
    queueEngine({ addReply: { status: 409, body: { detail: "already examples of another intent", texts: ["x"] } } });
    renderAt("/bots/sample/training");
    const row = (await screen.findByText("양자컴퓨터로 날씨 예측해줘")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "예문으로 추가" }));
    expect(await screen.findByText(/이미 다른 블록의 예문이에요/)).toBeInTheDocument();
  });

  it("reloads the draft when it changed elsewhere, and says when a sentence cannot be an example", async () => {
    queueEngine({ addReply: { status: 412, body: { detail: "moved", revision: 9 } } });
    renderAt("/bots/sample/training");
    const row = (await screen.findByText("양자컴퓨터로 날씨 예측해줘")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "예문으로 추가" }));
    expect(await screen.findByText(/다른 곳에서 바뀌었어요/)).toBeInTheDocument();
  });

  it.each([[422, "예문으로 넣을 수 없어요"], [500, "넣지 못했어요"]])("explains a %s from the engine", async (code, text) => {
    queueEngine({ addReply: { status: code, body: { detail: "no" } } });
    renderAt("/bots/sample/training");
    const row = (await screen.findByText("양자컴퓨터로 날씨 예측해줘")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "예문으로 추가" }));
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });

  it("warns when the period had more messages than were read, and shows an empty queue", async () => {
    queueEngine({ truncated: true });
    renderAt("/bots/sample/training");
    expect(await screen.findByText(/최근 20,000개만 봤어요/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("상태"), "added");
    expect(await screen.findByText("이 조건에 맞는 말이 없어요.")).toBeInTheDocument();
  });

  it("disables adding while the draft has unsaved changes", async () => {
    queueEngine();
    renderAt("/bots/sample/settings");
    await userEvent.type(await screen.findByLabelText("봇 이름"), "!");
    await userEvent.click(screen.getByRole("link", { name: "학습" }));
    expect(await screen.findByText(/예문으로 추가하려면 먼저 저장하거나/)).toBeInTheDocument();
    const row = (await screen.findByText("양자컴퓨터로 날씨 예측해줘")).closest("li") as HTMLElement;
    expect(within(row).getByRole("button", { name: "예문으로 추가" })).toBeDisabled();
  });

  it("shows what was done in 학습이력, and load errors with a retry", async () => {
    queueEngine();
    renderAt("/bots/sample/training");
    await userEvent.click(await screen.findByRole("button", { name: "학습이력" }));
    const list = await screen.findByRole("list", { name: "학습이력" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.replace(/ · .*$/, ""))).toEqual([
      "양자컴퓨터로 날씨 예측해줘‘날씨 안내’ 예문으로 추가", "주식 추천무시", "주식 추천되돌림"]);
  });

  it("explains a queue that cannot be loaded", async () => {
    botEngine({ extra: { [`GET ${B}/utterances`]: () => ({ status: 503, body: { detail: "temporarily unavailable" } }) } });
    renderAt("/bots/sample/training");
    expect(await screen.findByRole("button", { name: /다시 시도/ })).toBeInTheDocument();
  });

  it("starts periods at local midnight", () => {
    const now = new Date(2026, 10, 10, 15, 30);
    expect(new Date(periodStart(0, now) as string)).toEqual(new Date(2026, 10, 10, 0, 0));
    expect(new Date(periodStart(7, now) as string)).toEqual(new Date(2026, 10, 3, 0, 0));
    expect(periodStart(null, now)).toBeNull();
  });
});

describe("머신러닝", () => {
  it("sets a similarity level, exact-only blocks and keyword match, and saves them", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/ml");
    expect(await screen.findByLabelText(/직접 정한 값/)).toBeChecked();
    await userEvent.click(screen.getByLabelText(/^높음/));
    expect(screen.getByText(/계산할 수 없어요|테스트 빌드\)는 계산 없이/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("현재 시각"));
    await userEvent.click(screen.getByLabelText(/조사·어미만 다른 말/));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/저장했어요/);
    const saved = state.puts.at(-1)?.body as unknown as BotDoc;
    expect(saved.settings).toMatchObject({ similarity_level: "high", keyword_match: true });
    expect(saved.intents?.time?.exact_only).toBe(true);
  });

  it("shows confusable blocks from the newest test build", async () => {
    botEngine({ buildResult: { confusable: [{ a: "weather", b: "temperature", similarity: 0.946, example_a: "날씨 어때", example_b: "기온 어때" }, { a: 1 }] } });
    renderAt("/bots/sample/ml");
    expect(await screen.findByText(/저장해서 테스트 빌드가 만들어지면/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "봇테스트" }));
    await userEvent.click(await screen.findByRole("button", { name: "지금 저장된 초안으로 빌드" }));
    const section = await screen.findByRole("region", { name: "헷갈리는 블록" });
    expect(await within(section).findByText("0.95")).toBeInTheDocument();
    expect(within(section).getByText("날씨 안내")).toBeInTheDocument();
    expect(within(section).getByText(/“날씨 어때” \/ “기온 어때”/)).toBeInTheDocument();
  });
});

describe("ML model helpers", () => {
  it("removes keys set back to their defaults, so untouched documents stay the same", () => {
    expect(setLevel(setLevel(SAMPLE, "low"), null)).toEqual(SAMPLE);
    expect(setKeywordMatch(setKeywordMatch(SAMPLE, true), false)).toEqual(SAMPLE);
    expect(setExactOnly(setExactOnly(SAMPLE, "time", true), "time", false)).toEqual(SAMPLE);
    const bare = { id: "b", scenarios: {}, responses: {} } as BotDoc;
    expect(setLevel(setLevel(bare, "high"), null)).toEqual(bare); // no settings key left behind
    expect(() => setExactOnly(SAMPLE, "nope", true)).toThrow("no intent nope");
  });

  it("counts the intents the classifier still trains on", () => {
    const all = Object.keys(SAMPLE.intents ?? {}).length;
    expect(classifierIntents(setExactOnly(SAMPLE, "time", true))).toHaveLength(all - 1);
  });

  it("reads confusable pairs defensively", () => {
    expect(confusableOf(null)).toEqual([]);
    expect(confusableOf({ confusable: "x" })).toEqual([]);
    expect(confusableOf({ confusable: [{ a: "x", b: "y", similarity: 0.9, example_a: "", example_b: "" }, null, { a: "x" }] }))
      .toHaveLength(1);
  });
});
