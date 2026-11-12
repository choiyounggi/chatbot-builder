import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { DraftProvider } from "../draft/DraftContext";
import { presetRange } from "../model/analytics";
import { fakeEngine, type Handler, type Reply } from "../test/engine";
import { Analytics } from "./Analytics";

const NOW = new Date("2026-11-12T03:00:00+09:00"); // KST 오늘 = 2026-11-12

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderAnalytics() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <DraftProvider botId="sample">
        <Analytics />
      </DraftProvider>
    </Providers>,
  );
}

const DRAFT_ROUTE: Handler = () => ({ body: { id: "sample", label: "샘플", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } });

const TOTALS = {
  users: 3, new_users: 3, returning_users: 0, sessions: 5, messages: 8, block_calls: 5,
  fallbacks: 2, knowledge_answers: 1, knowledge_rate: 1 / 3,
};

const SAMPLE_REPORT = {
  bot: "sample", from: "2026-11-06", to: "2026-11-12", timezone: "Asia/Seoul",
  totals: TOTALS,
  days: [
    { date: "2026-11-06", users: 0, new_users: 0, returning_users: 0, sessions: 0, messages: 0, block_calls: 0, fallbacks: 0, knowledge_answers: 0 },
    { date: "2026-11-07", users: 3, new_users: 3, returning_users: 0, sessions: 5, messages: 8, block_calls: 5, fallbacks: 2, knowledge_answers: 1 },
  ],
  blocks: [
    { block: "greet", label: "인사", calls: 3 },
    { block: "weather", label: "날씨 안내", calls: 2 },
  ],
  retention: [
    { date: "2026-11-07", new_users: 3, d1: 0.667, d7: null },
  ],
};

function engine(options: { analytics?: Reply; draft?: Handler } = {}) {
  const routes: Record<string, Handler> = {
    "GET /v1/builder/bots/sample/draft": options.draft ?? DRAFT_ROUTE,
    "GET /v1/builder/bots/sample/analytics?from=2026-11-06&to=2026-11-12": () => options.analytics ?? { body: SAMPLE_REPORT },
  };
  return fakeEngine(routes);
}

/** `fetchMock`의 analytics 호출만 쿼리 문자열로 뽑아요. */
function analyticsCalls(fetchMock: ReturnType<typeof engine>): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes("/analytics"));
}

describe("기본 기간", () => {
  it("한국 시간 기준 최근 7일을 기본으로 요청해요", async () => {
    vi.setSystemTime(NOW);
    const fetchMock = engine();
    renderAnalytics();
    await screen.findByText("요약");
    const expected = presetRange(7, NOW);
    expect(analyticsCalls(fetchMock)).toEqual([
      `/v1/builder/bots/sample/analytics?from=${expected.from}&to=${expected.to}`,
    ]);
  });

  it("불러오는 동안 스켈레톤을 보여줘요", async () => {
    vi.setSystemTime(NOW);
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/analytics")) {
        await gate;
        return new Response(JSON.stringify(SAMPLE_REPORT), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "sample", label: "샘플", scenarios: {}, responses: {} }),
        { status: 200, headers: { "Content-Type": "application/json", ETag: '"1"' } });
    }));
    renderAnalytics();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    release();
    await screen.findByText("요약");
  });
});

describe("기간 프리셋", () => {
  it("최근 30일을 고르면 다시 계산한 날짜로 요청해요", async () => {
    vi.setSystemTime(NOW);
    const fetchMock = engine();
    renderAnalytics();
    await screen.findByText("요약");
    await userEvent.click(screen.getByRole("button", { name: "최근 30일" }));
    const expected = presetRange(30, NOW);
    await waitFor(() => expect(analyticsCalls(fetchMock)).toContain(
      `/v1/builder/bots/sample/analytics?from=${expected.from}&to=${expected.to}`,
    ));
  });
});

describe("직접 고르기", () => {
  it("92일은 요청하고, 93일은 이유를 보여주고 요청하지 않아요", async () => {
    vi.setSystemTime(NOW);
    const fetchMock = engine();
    renderAnalytics();
    await screen.findByText("요약");
    await userEvent.click(screen.getByRole("button", { name: "직접 고르기" }));
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-04-02" } }); // 정확히 92일
    await waitFor(() => expect(analyticsCalls(fetchMock)).toContain(
      "/v1/builder/bots/sample/analytics?from=2026-01-01&to=2026-04-02",
    ));
    const before = analyticsCalls(fetchMock).length;

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-04-03" } }); // 93일: 거절
    expect(await screen.findByText("기간은 최대 92일까지예요.")).toBeInTheDocument();
    expect(analyticsCalls(fetchMock).length).toBe(before); // 새 요청을 보내지 않았어요
  });

  it("시작일이 종료일보다 늦으면 이유를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine();
    renderAnalytics();
    await screen.findByText("요약");
    await userEvent.click(screen.getByRole("button", { name: "직접 고르기" }));
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-11-01" } });
    expect(await screen.findByText("시작일은 종료일보다 늦을 수 없어요.")).toBeInTheDocument();
  });
});

describe("요약", () => {
  it("합계 타일과 지식베이스 응답률 의미를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine();
    const { container } = renderAnalytics();
    await screen.findByText("요약");
    const tiles = container.querySelector(".stat-tiles") as HTMLElement;
    const usersTile = within(tiles).getByText("사용자").closest("li") as HTMLElement;
    expect(within(usersTile).getByText("3")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument(); // knowledge_rate 0.333 -> 33%
    expect(screen.getByText("응답률 = 지식베이스 답 / (지식베이스 답 + 폴백)")).toBeInTheDocument();
  });

  it("지식베이스 응답률이 null이면 —를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { body: { ...SAMPLE_REPORT, totals: { ...TOTALS, fallbacks: 0, knowledge_answers: 0, knowledge_rate: null } } } });
    renderAnalytics();
    await screen.findByText("요약");
    const rateTile = screen.getByText("지식베이스 응답률").closest("li") as HTMLElement;
    expect(within(rateTile).getByText("—")).toBeInTheDocument();
  });
});

describe("일별", () => {
  it("0인 날을 포함해 모든 날짜 행을 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine();
    renderAnalytics();
    const rows = await screen.findAllByRole("row");
    const zeroDay = rows.find((r) => within(r).queryByText("2026-11-06"));
    expect(zeroDay).toBeTruthy();
    const activeDay = rows.find((r) => within(r).queryByText("2026-11-07"));
    expect(within(activeDay as HTMLElement).getByText("8")).toBeInTheDocument(); // messages
  });
});

describe("블록 순위", () => {
  it("순서를 유지하고 전체 호출 대비 비중을 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine();
    renderAnalytics();
    const heading = await screen.findByRole("heading", { name: "블록 순위" });
    const table = heading.parentElement as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1); // 헤더 제외
    expect(within(rows[0] as HTMLElement).getByText("인사")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("greet")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("60%")).toBeInTheDocument(); // 3/5
    expect(within(rows[1] as HTMLElement).getByText("날씨 안내")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("40%")).toBeInTheDocument(); // 2/5
  });

  it("호출된 블록이 없으면 안내해요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { body: { ...SAMPLE_REPORT, blocks: [] } } });
    renderAnalytics();
    expect(await screen.findByText("이 기간에 호출된 블록이 없어요.")).toBeInTheDocument();
  });
});

describe("잔존율", () => {
  it("다음 날은 퍼센트로, 7일 뒤가 아직이면 —로 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine();
    renderAnalytics();
    const heading = await screen.findByRole("heading", { name: "잔존율" });
    const table = heading.parentElement as HTMLElement;
    expect(within(table).getByText("67%")).toBeInTheDocument(); // d1 0.667
    expect(within(table).getByText("—")).toBeInTheDocument(); // d7 null
  });

  it("새로 들어온 사용자가 없으면 안내해요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { body: { ...SAMPLE_REPORT, retention: [] } } });
    renderAnalytics();
    expect(await screen.findByText("이 기간에 새로 들어온 사용자가 없어요.")).toBeInTheDocument();
  });
});

describe("빈 기간", () => {
  it("이 기간에 사용자 대화가 없으면 안내만 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({
      analytics: {
        body: {
          ...SAMPLE_REPORT,
          totals: { users: 0, new_users: 0, returning_users: 0, sessions: 0, messages: 0, block_calls: 0, fallbacks: 0, knowledge_answers: 0, knowledge_rate: null },
          days: [], blocks: [], retention: [],
        },
      },
    });
    renderAnalytics();
    expect(await screen.findByText("이 기간에는 사용자 대화가 없어요.")).toBeInTheDocument();
    expect(screen.queryByText("요약")).not.toBeInTheDocument();
  });
});

describe("오류", () => {
  it("422면 엔진이 보낸 이유를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { status: 422, body: { detail: "the period must be at most 92 days" } } });
    renderAnalytics();
    expect(await screen.findByText("엔진이 이 기간을 받지 않았어요: the period must be at most 92 days")).toBeInTheDocument();
  });

  it("409면 고정 안내를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { status: 409, body: { detail: "bot is waiting to be deleted" } } });
    renderAnalytics();
    expect(await screen.findByText("봇이 삭제 대기 중이에요. 봇 목록에서 되살릴 수 있어요.")).toBeInTheDocument();
  });

  it("그 밖의 오류는 공통 오류 화면을 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({ analytics: { status: 500, body: { detail: "internal error" } } });
    renderAnalytics();
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
  });
});

describe("리뷰 후 고친 것", () => {
  it("말은 없어도 웰컴 블록이 열렸으면 블록 순위를 보여줘요", async () => {
    vi.setSystemTime(NOW);
    engine({
      analytics: {
        body: {
          ...SAMPLE_REPORT,
          totals: { users: 0, new_users: 0, returning_users: 0, sessions: 0, messages: 0, block_calls: 3, fallbacks: 0, knowledge_answers: 0, knowledge_rate: null },
          days: [{ date: "2026-11-12", users: 0, new_users: 0, returning_users: 0, sessions: 0, messages: 0, block_calls: 3, fallbacks: 0, knowledge_answers: 0 }],
          blocks: [{ block: "welcome", label: "웰컴", calls: 3 }], retention: [],
        },
      },
    });
    renderAnalytics();
    expect(await screen.findByText("웰컴")).toBeInTheDocument();
    expect(screen.queryByText("이 기간에는 사용자 대화가 없어요.")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".analytics-dot--sessions")).toHaveLength(1); // one day: sessions get a dot too
  });
});
