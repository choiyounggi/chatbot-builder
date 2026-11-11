import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { formatDateTime, parseVersionJobError, parseVersionJobResult } from "../api/deploy";
import { DraftProvider, useDraft } from "../draft/DraftContext";
import { fakeEngine, type Handler, type Reply } from "../test/engine";
import { Deploy, trainingMessage } from "./Deploy";

afterEach(() => vi.unstubAllGlobals());

function DirtyToggle() {
  const draft = useDraft();
  return (
    <button type="button" disabled={!draft.doc} onClick={() => draft.update((d) => ({ ...d, label: "임시" }))}>
      dirty
    </button>
  );
}

function renderDeploy(shared?: ReturnType<typeof createQueryClient>) {
  const client = shared ?? createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <DraftProvider botId="sample">
        <DirtyToggle />
        <Deploy />
      </DraftProvider>
    </Providers>,
  );
}

const DRAFT_ROUTE: Handler = () => ({ body: { id: "sample", label: "샘플", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } });

const SAMPLE_VERSIONS = {
  bot: "sample",
  live: "v2000000000a",
  versions: [
    { version: "v3000000000a", number: 3, created_at: "2026-11-10T01:00:00+00:00", macro_f1: null, live: false },
    { version: "v2000000000a", number: 2, created_at: "2026-11-09T01:00:00+00:00", macro_f1: 0.93, live: true },
    { version: "v1000000000a", number: 1, created_at: "2026-11-08T01:00:00+00:00", macro_f1: 0.88, live: false },
  ],
  history: [
    { version: "v2000000000a", number: 2, note: "두 번째 배포", deployed_at: "2026-11-09T02:00:00+00:00" },
    { version: "v1000000000a", number: 1, note: "", deployed_at: "2026-11-08T02:00:00+00:00" },
  ],
};

const DONE_RESULT = {
  version: "v3000000000a", number: 3, macro_f1: 0.95, clarify_rate: 0.1,
  per_intent_f1: { greeting: 1.0, weather: 0.6, help: 0.7, bye: 0.95, thanks: 0.99, escape: 0.4 },
  warnings: ["bye 의도의 예문이 7개뿐이에요"],
  thresholds: { intent_threshold: 0.3, similarity_threshold: 0.39, ambiguity_margin: 0.1, level: "normal" },
  confusable: [{ a: "weather", b: "weather_tomorrow", similarity: 0.86, example_a: "날씨 어때", example_b: "내일 날씨 어때" }],
};

const jobBody = (status: "queued" | "running" | "done" | "failed", result: unknown = null, error: unknown = null) => ({
  id: "job1", kind: "version", bot: "sample", created_at: "2026-11-10T00:00:00+00:00",
  finished_at: status === "done" || status === "failed" ? "2026-11-10T00:00:05+00:00" : null,
  status, result, error,
});

function engine(options: {
  versions?: Reply;
  trainReply?: Reply;
  trainGate?: Promise<void>;
  jobReply?: Reply;
  deployReply?: Reply;
  rollbackReply?: Reply;
  draft?: Handler;
  kb?: Reply;
} = {}) {
  const calls: string[] = [];
  const routes: Record<string, Handler> = {
    "GET /v1/builder/bots/sample/draft": options.draft ?? DRAFT_ROUTE,
    "GET /v1/builder/bots/sample/versions": () => {
      calls.push("versions");
      return options.versions ?? { body: SAMPLE_VERSIONS };
    },
    "POST /v1/builder/bots/sample/versions": async () => {
      await options.trainGate;
      return options.trainReply ?? { status: 202, body: jobBody("queued") };
    },
    "GET /v1/builder/jobs/job1": () => options.jobReply ?? { body: jobBody("done", DONE_RESULT) },
    "POST /v1/builder/bots/sample/deploy": () => options.deployReply ?? { body: { bot: "sample", live: "v3000000000a" } },
    "POST /v1/builder/bots/sample/rollback": () => options.rollbackReply ?? { body: { bot: "sample", live: "v1000000000a" } },
    "GET /v1/builder/bots/sample/knowledge/versions": () => options.kb ?? { body: { bot: "sample", live: null, versions: [] } },
  };
  return { fetchMock: fakeEngine(routes), calls };
}

describe("버전 목록", () => {
  it("버전, 생성 시각, macro-F1, 라이브 배지를 보여줘요", async () => {
    engine();
    renderDeploy();
    const rows = await screen.findAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("v3")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("—")).toBeInTheDocument(); // macro_f1 null
    expect(within(rows[2] as HTMLElement).getByText("0.93")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("라이브")).toBeInTheDocument();
  });

  it("학습된 버전이 없으면 안내하고, 배포·되돌리기도 비활성화해요", async () => {
    engine({ versions: { body: { bot: "sample", live: null, versions: [], history: [] } } });
    renderDeploy();
    expect(await screen.findByText("아직 학습된 버전이 없어요. 아래에서 배포용 학습을 시작해 보세요.")).toBeInTheDocument();
    expect(screen.getByText("학습된 버전이 있어야 배포할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeDisabled();
  });

  it("목록을 못 불러오면 오류를 보여줘요", async () => {
    engine({ versions: { status: 500, body: { detail: "internal error" } } });
    renderDeploy();
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
  });
});

describe("배포용 학습", () => {
  it("저장 안 된 변경이 있으면 저장된 초안만 학습된다고 알려줘요", async () => {
    engine();
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "dirty" }));
    expect(screen.getByText("저장된 초안만 학습돼요. 지금 화면의 변경은 아직 저장되지 않았어요.")).toBeInTheDocument();
  });

  it("진행 중에는 버튼이 꺼지고, 끝나면 결과를 보여주고 버전 목록을 새로고쳐요", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { calls } = engine({ trainGate: gate });
    renderDeploy();
    await screen.findByText("아직 학습을 시작하지 않았어요");
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(screen.getByRole("button", { name: "학습 중…" })).toBeDisabled();
    expect(screen.getByText("배포용 학습을 진행하고 있어요…")).toBeInTheDocument();
    release();
    await screen.findByText("학습을 마쳤어요 · macro-F1 0.95");
    expect(screen.getByText("escape")).toBeInTheDocument();
    expect(screen.queryByText("greeting")).not.toBeInTheDocument(); // only the lowest five of six intents
    expect(screen.getByText("bye 의도의 예문이 7개뿐이에요")).toBeInTheDocument();
    expect(screen.getByText("보통")).toBeInTheDocument();
    expect(screen.getByText("weather ↔ weather_tomorrow · 0.86")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c === "versions").length).toBeGreaterThan(1));
  });

  it("below_bar 실패는 기준 설명과 낮은 의도 다섯 개를 보여줘요", async () => {
    engine({ jobReply: { body: jobBody("failed", null, {
      kind: "below_bar", detail: "macro-F1 0.81로 기준 0.90에 못 미쳤어요",
      per_intent_f1: { a: 0.3, b: 0.5, c: 0.6, d: 0.7, e: 0.8, f: 0.95 },
    }) } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByRole("heading", { name: "학습하지 못했어요" })).toBeInTheDocument();
    expect(screen.getByText("macro-F1 0.81로 기준 0.90에 못 미쳤어요")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("f")).not.toBeInTheDocument();
  });

  it("invalid_draft 실패는 문제 목록을 그대로 보여줘요", async () => {
    engine({ jobReply: { body: jobBody("failed", null, {
      kind: "invalid_draft", errors: ["scenario check_weather step 2: missing response"],
    }) } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("scenario check_weather step 2: missing response")).toBeInTheDocument();
  });

  it("training 실패는 엔진 설명을 그대로 보여줘요", async () => {
    engine({ jobReply: { body: jobBody("failed", null, { kind: "training", detail: "의도가 2개는 있어야 학습할 수 있어요" }) } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("의도가 2개는 있어야 학습할 수 있어요")).toBeInTheDocument();
  });

  it("no_draft 실패는 고정 안내를 보여줘요", async () => {
    engine({ jobReply: { body: jobBody("failed", null, { kind: "no_draft" }) } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("저장된 초안이 없어요. 블록을 만들고 저장한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
  });

  it("처음 보는 실패 종류도 엔진 설명을 그대로 보여줘요", async () => {
    engine({ jobReply: { body: jobBody("failed", null, { kind: "weird", detail: "처음 보는 오류예요" }) } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("처음 보는 오류예요")).toBeInTheDocument();
  });

  it("학습 시작 요청 자체가 실패하면 다시 시도할 수 있어요", async () => {
    engine({ trainReply: { status: 500, body: { detail: "internal error" } } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
  });

  it("작업 상태 확인이 실패하면 안내해요", async () => {
    engine({ jobReply: { status: 500, body: { detail: "internal error" } } });
    renderDeploy();
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("학습 상태를 확인하지 못했어요")).toBeInTheDocument();
  });
});

describe("배포", () => {
  it("버전을 골라 배포하면 메모와 함께 보내고 'v{n} 배포됨'을 보여줘요", async () => {
    const { fetchMock } = engine();
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("배포할 버전")).toHaveValue("v3000000000a"));
    await userEvent.selectOptions(screen.getByLabelText("배포할 버전"), "v2000000000a");
    await userEvent.type(screen.getByLabelText("메모 (선택)"), "주말 응답 수정");
    expect(screen.getByText("8/100자")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("v2 배포됨 · 지식베이스 없음")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/deploy"));
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body).toEqual({ version: "v2000000000a", note: "주말 응답 수정", knowledge_version: null }); // none built
  });

  it("404/409면 엔진이 보낸 이유를 그대로 보여줘요", async () => {
    engine({ deployReply: { status: 409, body: { detail: "이미 다른 버전을 배포하는 중이에요" } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("배포할 버전")).toHaveValue("v3000000000a"));
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("이미 다른 버전을 배포하는 중이에요")).toBeInTheDocument();
  });
});

describe("이전 버전으로 되돌리기", () => {
  it("이전 배포가 하나뿐이면 버튼이 꺼져 있어요", async () => {
    engine({ versions: { body: { ...SAMPLE_VERSIONS, history: [SAMPLE_VERSIONS.history[0]] } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("배포할 버전")).toHaveValue("v3000000000a"));
    expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeDisabled();
  });

  it("확인한 뒤에만 되돌리고, 성공하면 알려줘요", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    engine();
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "이전 버전으로 되돌리기" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(await screen.findByText("이전 버전으로 되돌렸어요 · 지식베이스 없음")).toBeInTheDocument();
  });

  it("확인을 취소하면 요청을 보내지 않아요", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { fetchMock } = engine();
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "이전 버전으로 되돌리기" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/rollback"))).toBe(false);
  });

  it("되돌릴 배포가 없으면 고정 안내를 보여줘요(원문 대신)", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    engine({ rollbackReply: { status: 409, body: { detail: "no earlier deployment" } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "이전 버전으로 되돌리기" }));
    expect(await screen.findByText("되돌릴 이전 배포가 없어요")).toBeInTheDocument();
    expect(screen.queryByText("no earlier deployment")).not.toBeInTheDocument();
  });
});

describe("배포 히스토리", () => {
  it("버전·메모·시각과 라이브 표시를 보여주고, 메모가 없으면 안내해요", async () => {
    engine();
    renderDeploy();
    const list = await screen.findAllByRole("table");
    const history = list[1] as HTMLElement;
    expect(within(history).getByText("두 번째 배포")).toBeInTheDocument();
    expect(within(history).getByText("메모 없음")).toBeInTheDocument();
    expect(within(history).getByText("라이브")).toBeInTheDocument();
  });

  it("배포한 적이 없으면 안내해요", async () => {
    engine({ versions: { body: { bot: "sample", live: null, versions: [], history: [] } } });
    renderDeploy();
    expect(await screen.findByText("아직 배포한 적이 없어요.")).toBeInTheDocument();
  });
});

describe("api/deploy.ts의 방어적 파싱", () => {
  it("날짜 문자열을 현지 시각으로, 못 읽으면 원문 그대로 보여줘요", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(formatDateTime("2026-01-01T00:00:00+00:00")).not.toBe("");
  });

  it("job 결과가 비어 있으면 모든 필드를 안전한 기본값으로 다뤄요", () => {
    expect(parseVersionJobResult(null)).toEqual({
      macroF1: null, clarifyRate: null, perIntentF1: null, warnings: [], thresholds: null, confusable: [],
    });
  });

  it("thresholds의 level이 다섯 단계 중 하나가 아니면 '직접 설정'으로 보여줘요", () => {
    const result = parseVersionJobResult({ thresholds: { level: "custom" } });
    expect(result.thresholds?.levelLabel).toBe("직접 설정");
  });

  it("confusable 항목이 엔진 모양이 아니면 건너뛰어요", () => {
    const result = parseVersionJobResult({ confusable: [{ a: "x" }, "oops", { a: "weather", b: "weather2" },
      { a: "weather", b: "temperature", similarity: 0.95, example_a: "날씨", example_b: "기온" }] });
    expect(result.confusable).toEqual([{ label: "weather ↔ temperature", score: 0.95 }]);
    expect(parseVersionJobResult({ thresholds: { level: "normal" } }).thresholds?.levelLabel).toBe("보통");
  });

  it("job 오류에 kind가 없으면 unknown으로 다뤄요", () => {
    expect(parseVersionJobError(null)).toEqual({ kind: "unknown", detail: null });
  });

  it("below_bar/training에 detail이 없으면 기본 문구를 써요", () => {
    expect(parseVersionJobError({ kind: "below_bar" })).toEqual({ kind: "below_bar", detail: "기준에 미달했어요", perIntentF1: null });
    expect(parseVersionJobError({ kind: "training" })).toEqual({ kind: "training", detail: "학습하지 못했어요" });
  });
});


describe("trainingMessage", () => {
  const label = (i: string) => ({ weather: "날씨 안내" } as Record<string, string>)[i] ?? i;
  it("names the blocks with too few examples in Korean", () => {
    expect(trainingMessage("intents need at least 5 examples for evaluation: ['weather', 'block_1']", label))
      .toBe("예문이 5개보다 적은 블록이 있어 배포용 학습을 할 수 없어요: 날씨 안내, block_1. 블록마다 예문을 5개 이상 넣어 주세요.");
  });
  it("explains a bot with fewer than two intents, and keeps any other detail", () => {
    expect(trainingMessage("need at least two intents", label)).toBe("학습할 블록이 둘 이상 있어야 해요.");
    expect(trainingMessage("something else", label)).toBe("something else");
    expect(trainingMessage("", label)).toBe("");
  });
});


describe("block names in results", () => {
  it("shows the block's name for an intent id in the lowest scores and confusable pairs", async () => {
    const draft: Handler = () => ({ body: { id: "sample", intents: { weather: { examples: ["날씨"] } },
      scenarios: { check_weather: { label: "날씨 안내", trigger: { intent: "weather" }, steps: [] } }, responses: {} },
    headers: { ETag: '"1"' } });
    engine({ draft });
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    await screen.findByText("학습을 마쳤어요 · macro-F1 0.95");
    expect(screen.getByText("날씨 안내 ↔ weather_tomorrow · 0.86")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "날씨 안내 weather · 0.60")).toBeInTheDocument();
  });
});

describe("training failures in Korean", () => {
  it("names the blocks that need more examples", async () => {
    engine({ jobReply: { body: jobBody("failed", null, { kind: "training", detail: "intents need at least 5 examples for evaluation: ['coupon']" }) } });
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    expect(await screen.findByText("예문이 5개보다 적은 블록이 있어 배포용 학습을 할 수 없어요: coupon. 블록마다 예문을 5개 이상 넣어 주세요."))
      .toBeInTheDocument();
  });
});


describe("review fixes", () => {
  const LIVE_NEWEST = { ...SAMPLE_VERSIONS, live: "v3000000000a",
    versions: SAMPLE_VERSIONS.versions.map((v) => ({ ...v, live: v.number === 3 })),
    history: [{ version: "v3000000000a", number: 3, note: "rollback", deployed_at: "2026-11-10T02:00:00+00:00" }, ...SAMPLE_VERSIONS.history] };

  it("preselects the newest version and says when it is already live", async () => {
    engine({ versions: { body: LIVE_NEWEST } });
    renderDeploy();
    const select = await screen.findByLabelText("배포할 버전");
    expect(select).toHaveValue("v3000000000a"); // never a silent downgrade to v2
    expect(screen.getByText("이 버전은 지금 배포되어 있어요.")).toBeInTheDocument();
    expect(screen.getByText("되돌리기")).toBeInTheDocument(); // the engine's "rollback" note in Korean
  });

  it("selects the version a training just made", async () => {
    engine();
    renderDeploy();
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    await screen.findByText("학습을 마쳤어요 · macro-F1 0.95");
    expect(screen.getByLabelText("배포할 버전")).toHaveValue("v3000000000a");
  });

  it("keeps following a running training after leaving the page", async () => {
    engine({ jobReply: { body: jobBody("running") } });
    const client = createQueryClient();
    const first = renderDeploy(client);
    await waitFor(() => expect(screen.getByRole("button", { name: "dirty" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "배포용 학습" }));
    await screen.findByText("배포용 학습을 진행하고 있어요…");
    first.unmount();
    renderDeploy(client);
    expect(await screen.findByText("배포용 학습을 진행하고 있어요…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "학습 중…" })).toBeDisabled();
  });

  it.each([
    [{ detail: "there is no earlier deployment to go back to" }, "되돌릴 이전 배포가 없어요"],
    [{ detail: "the previous version has no trained model; train it first" }, "그 버전의 모델 파일이 없어요. 다시 학습한 뒤 배포해 주세요."],
    [{ detail: { detail: "the previous version cannot run here", errors: ["unknown action 'x'"] } }, "그 버전은 지금 엔진에서 돌릴 수 없어요: unknown action 'x'"],
  ])("explains a rollback refused with %j", async (body, text) => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    engine({ rollbackReply: { status: 409, body } });
    renderDeploy();
    await userEvent.click(await screen.findByRole("button", { name: "이전 버전으로 되돌리기" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("clears the deploy line after a rollback and the other way round", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    engine();
    renderDeploy();
    await userEvent.click(await screen.findByRole("button", { name: "배포" }));
    await screen.findByText(/v\d 배포됨/);
    await userEvent.click(screen.getByRole("button", { name: "이전 버전으로 되돌리기" }));
    await screen.findByText(/이전 버전으로 되돌렸어요/);
    expect(screen.queryByText(/v\d 배포됨/)).toBeNull();
  });
});


describe("지식베이스와 함께 배포", () => {
  const KB = {
    bot: "sample", live: "k1000000000a",
    versions: [
      { version: "k2000000000a", number: 2, created_at: "2026-11-11T01:00:00+00:00", faq: 3, chunks: 7, live: false },
      { version: "k1000000000a", number: 1, created_at: "2026-11-10T01:00:00+00:00", faq: 2, chunks: 5, live: true },
    ],
  };
  const deployBody = (fetchMock: ReturnType<typeof engine>["fetchMock"]) =>
    JSON.parse(String((fetchMock.mock.calls.find(([url]) => String(url).endsWith("/deploy"))?.[1] as RequestInit).body)) as unknown;

  it("기본은 라이브 색인이고, 다른 것을 고르면 바뀐다고 알려주고, 배포 결과에 지식베이스를 적어요", async () => {
    const { fetchMock } = engine({ kb: { body: KB }, deployReply: { body: { bot: "sample", live: "v3000000000a", knowledge_version: "k2000000000a" } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("지식베이스")).toHaveValue("k1000000000a"));
    expect(screen.getByRole("option", { name: "v1 · FAQ 2개 · 조각 5개 · 라이브" })).toBeInTheDocument();
    expect(screen.getByText("지금 라이브: v1")).toBeInTheDocument();
    expect(screen.queryByText(/배포하면 지식베이스가/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("지식베이스"), "k2000000000a");
    expect(screen.getByText("배포하면 지식베이스가 v1에서 v2(으)로 바뀌어요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("v3 배포됨 · 지식베이스 v2")).toBeInTheDocument();
    expect(deployBody(fetchMock)).toEqual({ version: "v3000000000a", note: "", knowledge_version: "k2000000000a" });
  });

  it("'없음'을 고르면 지식베이스 없이 배포해요", async () => {
    const { fetchMock } = engine({ kb: { body: KB } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("지식베이스")).toHaveValue("k1000000000a"));
    await userEvent.selectOptions(screen.getByLabelText("지식베이스"), "");
    expect(screen.getByText("배포하면 지식베이스가 v1에서 없음(으)로 바뀌어요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    await screen.findByText(/배포됨/);
    expect(deployBody(fetchMock)).toEqual({ version: "v3000000000a", note: "", knowledge_version: null });
  });

  it("목록을 못 불러오면 지식베이스를 보내지 않아 지금 것이 유지돼요", async () => {
    const { fetchMock } = engine({ kb: { status: 500, body: { detail: "boom" } } });
    renderDeploy();
    expect(await screen.findByText("지식베이스 목록을 불러오지 못했어요. 지금 배포된 지식베이스가 그대로 유지돼요.")).toBeInTheDocument();
    expect(screen.getByLabelText("지식베이스")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("v3 배포됨 · 지식베이스 그대로")).toBeInTheDocument();
    expect(deployBody(fetchMock)).toEqual({ version: "v3000000000a", note: "" });
  });

  it("히스토리에 지식베이스를 보여주고, 지식베이스만 달라도 되돌릴 수 있어요", async () => {
    const history = [
      { version: "v2000000000a", number: 2, note: "", deployed_at: "2026-11-11T02:00:00+00:00", knowledge_version: "k1000000000a" },
      { version: "v2000000000a", number: 2, note: "", deployed_at: "2026-11-10T02:00:00+00:00", knowledge_version: null },
    ];
    engine({ kb: { body: KB }, versions: { body: { ...SAMPLE_VERSIONS, history } } });
    renderDeploy();
    const table = (await screen.findByText("배포 히스토리")).parentElement as HTMLElement;
    await waitFor(() => expect(within(table).getAllByText("v1").length).toBe(1));
    expect(within(table).getByText("없음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeEnabled();
  });

  it("같은 쌍만 반복해서 배포했으면 되돌릴 수 없어요", async () => {
    const same = { version: "v2000000000a", number: 2, note: "", deployed_at: "2026-11-11T02:00:00+00:00", knowledge_version: "k1000000000a" };
    engine({ kb: { body: KB }, versions: { body: { ...SAMPLE_VERSIONS, history: [same, { ...same, deployed_at: "2026-11-10T02:00:00+00:00" }] } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("지식베이스")).toHaveValue("k1000000000a"));
    expect(screen.getByRole("button", { name: "이전 버전으로 되돌리기" })).toBeDisabled();
  });
});

describe("지식베이스와 함께 배포 (리뷰 후)", () => {
  it("목록을 불러오는 동안은 '불러오는 중'이라고 보여줘요", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { fetchMock } = engine();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/knowledge/versions") ? gate.then(() => new Response("{}", { status: 500 })) : fetchMock(input, init));
    renderDeploy();
    expect(await screen.findByRole("option", { name: "불러오는 중…" })).toBeInTheDocument();
    expect(screen.getByLabelText("지식베이스")).toBeDisabled();
    release();
  });

  it("쓸 수 없는 지식베이스로 배포가 거절되면 이유를 한국어로 보여줘요", async () => {
    engine({ deployReply: { status: 409, body: { detail: { detail: "the knowledge base cannot be used here", errors: ["stored knowledge base x hashes to y"] } } } });
    renderDeploy();
    await waitFor(() => expect(screen.getByLabelText("배포할 버전")).toHaveValue("v3000000000a"));
    await userEvent.click(screen.getByRole("button", { name: "배포" }));
    expect(await screen.findByText("그 지식베이스는 지금 쓸 수 없어요. 색인을 다시 만들어 주세요. (stored knowledge base x hashes to y)")).toBeInTheDocument();
  });

  it("히스토리의 라이브 표시는 맨 위 배포에만 붙어요", async () => {
    const history = [
      { version: "v2000000000a", number: 2, note: "", deployed_at: "2026-11-11T02:00:00+00:00", knowledge_version: "k1000000000a" },
      { version: "v2000000000a", number: 2, note: "", deployed_at: "2026-11-10T02:00:00+00:00", knowledge_version: null },
    ];
    engine({ versions: { body: { ...SAMPLE_VERSIONS, history } } });
    renderDeploy();
    const section = (await screen.findByText("배포 히스토리")).parentElement as HTMLElement;
    await waitFor(() => expect(within(section).getAllByRole("row")).toHaveLength(3));
    expect(within(section).getAllByText("라이브")).toHaveLength(1);
  });
});

