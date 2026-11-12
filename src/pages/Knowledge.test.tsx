// B6: the knowledge-base screen (FAQ·문서·검색 테스트·버전), its own draft and ETag apart from the
// bot draft (docs/builder-plan.md §6 B6, engine E-D).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { DraftProvider } from "../draft/DraftContext";
import { fakeEngine, headerOf, type Handler } from "../test/engine";
import { Knowledge } from "./Knowledge";

afterEach(() => vi.unstubAllGlobals());

function renderKnowledge(shared?: ReturnType<typeof createQueryClient>) {
  const client = shared ?? createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <DraftProvider botId="sample">
        <Knowledge />
      </DraftProvider>
    </Providers>,
  );
}

const B = "/v1/builder/bots/sample";
/** The hidden file input behind "파일 올리기" (out of the tab order; the button opens it). */
const fileInput = () => document.getElementById("kb-file-input") as HTMLInputElement;

const DOC = {
  faq: [{ id: "faq_1", question: "영업 시간이 어떻게 되나요?", answer: "평일 9시부터 6시까지예요." }],
  documents: [{ id: "doc_1", name: "안내문", text: "문의는 이메일로 해 주세요." }],
  settings: { mode: "instant", suggest_text: "이런 답을 찾았어요. 골라 주세요." },
};

const VERSION = { version: "1a2b3c4d5e6f", number: 1, created_at: "2026-11-10T01:00:00+00:00", faq: 1, chunks: 2, live: false };

function kbEngine(options: {
  draft?: Handler;
  put?: Handler;
  extract?: Handler;
  versions?: Handler;
  entries?: Handler;
  search?: Handler;
  buildResult?: Record<string, unknown>;
  buildError?: Record<string, unknown>;
  llm?: Handler;
} = {}) {
  const puts: { etag: string | null; body: Record<string, unknown> }[] = [];
  const uploads: { contentType: string | null; body: string }[] = [];
  const searches: { query: string; version?: string }[] = [];
  let jobs = 0;
  const jobState = new Map<string, { status: string; result: unknown; error: unknown }>();
  const routes: Record<string, Handler> = {
    [`GET ${B}/draft`]: () => ({ body: { id: "sample", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } }),
    [`GET ${B}/knowledge/draft`]: options.draft ?? (() => ({ body: structuredClone(DOC), headers: { ETag: '"1"' } })),
    [`PUT ${B}/knowledge/draft`]: async (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      puts.push({ etag: headerOf(init, "If-Match"), body });
      return options.put
        ? await options.put(init)
        : { body: { bot: "sample", version: "a1b2c3d4e5f6", revision: 2, valid: true, errors: [] }, headers: { ETag: '"2"' } };
    },
    [`POST ${B}/knowledge/extract`]: async (init) => {
      const text = init.body instanceof Blob ? await init.body.text() : String(init.body);
      uploads.push({ contentType: headerOf(init, "Content-Type"), body: text });
      return options.extract ? await options.extract(init) : { body: { text: "추출된 문서 내용이에요." } };
    },
    [`GET ${B}/knowledge/versions`]: options.versions ?? (() => ({ body: { bot: "sample", live: null, versions: [] } })),
    "GET /v1/builder/llm": options.llm ?? (() => ({ body: { configured: false, model: null, ok: null, ms: null, error: null } })),
    [`POST ${B}/knowledge/search`]: async (init) => {
      const body = JSON.parse(String(init.body)) as { query: string; version?: string };
      searches.push(body);
      return options.search ? await options.search(init) : { status: 409, body: { detail: "build the knowledge base first" } };
    },
    [`POST ${B}/knowledge/versions`]: () => {
      jobs += 1;
      const id = String(jobs).padStart(8, "0");
      jobState.set(id, options.buildError
        ? { status: "failed", result: null, error: options.buildError }
        : { status: "done", result: options.buildResult ?? { version: VERSION.version, number: 1, faq: 1, chunks: 2 }, error: null });
      return {
        status: 202,
        body: { id, kind: "knowledge", bot: "sample", created_at: "2026-11-10T00:00:00+00:00", status: "queued", result: null, error: null, finished_at: null },
      };
    },
  };
  const proxied = new Proxy(routes, {
    get(target, key: string) {
      if (key in target) return target[key];
      const entryMatch = key.match(/^GET \/v1\/builder\/bots\/sample\/knowledge\/versions\/([0-9a-f]+)\/entries$/);
      if (entryMatch) return options.entries ?? (() => ({ body: { bot: "sample", version: entryMatch[1], entries: [] } }));
      const jobMatch = key.match(/^GET \/v1\/builder\/jobs\/(\w+)$/);
      if (jobMatch?.[1] && jobState.has(jobMatch[1])) {
        const id = jobMatch[1];
        return () => ({
          body: { id, kind: "knowledge", bot: "sample", created_at: "2026-11-10T00:00:00+00:00", finished_at: "2026-11-10T00:00:01+00:00", ...jobState.get(id) },
        });
      }
      return undefined;
    },
  });
  return { fetchMock: fakeEngine(proxied), puts, uploads, searches };
}

describe("불러오기", () => {
  it("저장된 초안을 불러와 FAQ와 문서를 보여준다", async () => {
    kbEngine();
    renderKnowledge();
    expect(await screen.findByDisplayValue("영업 시간이 어떻게 되나요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    expect(await screen.findByText("안내문")).toBeInTheDocument();
  });

  it("지식베이스가 없으면(404) 빈 상태로 시작하고, 저장하면 ETag 없이 만든다", async () => {
    const { puts } = kbEngine({ draft: () => ({ status: 404, body: { detail: "'sample' has no knowledge base" } }) });
    renderKnowledge();
    expect(await screen.findByText("아직 FAQ가 없어요. 아래에서 추가해 보세요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "FAQ 추가" }));
    await userEvent.type(screen.getByLabelText("FAQ 1 질문"), "새 질문");
    await userEvent.type(screen.getByLabelText("FAQ 1 답"), "새 답");
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.etag).toBeNull();
    expect(puts[0]?.body.faq).toEqual([{ id: "faq_1", question: "새 질문", answer: "새 답" }]);
  });
});

describe("저장", () => {
  it("편집하고 저장하면 바뀐 내용과 ETag를 함께 보낸다", async () => {
    const { puts } = kbEngine();
    renderKnowledge();
    const question = await screen.findByLabelText("FAQ 1 질문");
    await userEvent.clear(question);
    await userEvent.type(question, "고친 질문");
    expect(screen.getByRole("button", { name: "지식베이스 저장" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.etag).toBe('"1"');
    expect(puts[0]?.body.faq).toEqual([{ id: "faq_1", question: "고친 질문", answer: "평일 9시부터 6시까지예요." }]);
    expect(await screen.findByText("지식베이스를 저장했어요 · 리비전 2")).toBeInTheDocument();
  });

  it("저장이 안 됐거나 바뀐 게 없으면 저장 버튼이 꺼진다", async () => {
    kbEngine();
    renderKnowledge();
    await screen.findByDisplayValue("영업 시간이 어떻게 되나요?");
    expect(screen.getByRole("button", { name: "지식베이스 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "지식베이스 변경 취소" })).toBeDisabled();
  });

  it("412면 다른 곳에서 바뀌었다고 안내하고, 다시 불러오기를 누르면 새로 읽는다", async () => {
    let reads = 0;
    const { puts } = kbEngine({
      draft: () => { reads += 1; return { body: structuredClone(DOC), headers: { ETag: '"1"' } }; },
      put: () => ({ status: 412, body: { detail: "moved", revision: 9 } }),
    });
    renderKnowledge();
    const question = await screen.findByLabelText("FAQ 1 질문");
    await userEvent.type(question, "!");
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    expect(await screen.findByText(/다른 곳에서 지식베이스가 바뀌었어요\. 다시 불러온 뒤 고쳐 주세요\. 다시 불러오면 저장하지 않은 변경은 사라져요\./)).toBeInTheDocument();
    expect(puts).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("button", { name: "지식베이스 저장" })).toBeDisabled();
    expect(screen.getByLabelText("FAQ 1 질문")).toHaveValue("영업 시간이 어떻게 되나요?"); // the edit is gone, as warned
  });

  it("저장은 유효하지 않아도 되고, 엔진이 돌려준 오류 목록을 보여준다", async () => {
    kbEngine({
      put: () => ({
        body: { bot: "sample", version: null, revision: 2, valid: false, errors: ["faq.0.question: must not be blank"] },
        headers: { ETag: '"2"' },
      }),
    });
    renderKnowledge();
    const question = await screen.findByLabelText("FAQ 1 질문");
    await userEvent.type(question, "!");
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    expect(await screen.findByText("저장했지만 고칠 곳이 1개 있어요")).toBeInTheDocument();
    expect(screen.getByText("FAQ 1 질문: must not be blank")).toBeInTheDocument();
  });
});

describe("FAQ", () => {
  it("FAQ를 추가하면 가장 작은 미사용 번호의 id를 쓴다", async () => {
    kbEngine();
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByRole("button", { name: "FAQ 추가" }));
    expect(await screen.findByLabelText("FAQ 2 질문")).toBeInTheDocument();
    expect(screen.getByText("FAQ 2개")).toBeInTheDocument();
    expect(document.getElementById("faq-faq_2-q")).not.toBeNull(); // faq_1 is taken: the new one is faq_2
  });

  it("행을 지우면 목록에서 사라진다", async () => {
    kbEngine();
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByLabelText("FAQ 1 질문")).toBeNull());
    expect(screen.getByText("아직 FAQ가 없어요. 아래에서 추가해 보세요.")).toBeInTheDocument();
  });

  it("트림한 질문이 같으면 경고하지만 저장은 막지 않는다", async () => {
    kbEngine();
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByRole("button", { name: "FAQ 추가" }));
    await userEvent.type(screen.getByLabelText("FAQ 2 질문"), " 영업 시간이 어떻게 되나요? ");
    expect(await screen.findAllByText("같은 질문이 이미 있어요")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "지식베이스 저장" })).toBeEnabled();
  });

  it("답안 추천형을 고르면 안내 문구를 고칠 수 있다", async () => {
    kbEngine();
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByLabelText(/답안 추천형/));
    const text = await screen.findByLabelText("안내 문구");
    expect(text).toHaveValue("이런 답을 찾았어요. 골라 주세요.");
    await userEvent.clear(text);
    await userEvent.type(text, "골라 주세요");
    expect(text).toHaveValue("골라 주세요");
  });
});

describe("문서", () => {
  it("파일을 올리면 추출한 텍스트로 문서가 만들어지고 선택된다", async () => {
    const { uploads } = kbEngine({ extract: () => ({ body: { text: "파일에서 뽑은 내용이에요." } }) });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    const file = new File(["파일 속 글자"], "공지.txt", { type: "text/plain" });
    await userEvent.upload(fileInput(), file);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0]).toEqual({ contentType: "text/plain", body: "파일 속 글자" });
    expect(await screen.findByText("공지.txt")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("파일에서 뽑은 내용이에요.")).toBeInTheDocument();
  });

  it("지원하지 않는 확장자는 엔진에 묻지 않고 바로 안내한다", async () => {
    const { uploads } = kbEngine();
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    const file = new File(["x"], "표.csv", { type: "text/csv" });
    const input = fileInput() as HTMLInputElement;
    // userEvent.upload refuses a file that does not match `accept` (realistic OS picker behaviour);
    // this checks the page's own guard, so the file is attached directly, as a bypassed picker would.
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByText("PDF, 텍스트(.txt), 마크다운(.md)만 올릴 수 있어요.")).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
  });

  it("추출이 422면 엔진이 준 이유를 보여준다", async () => {
    kbEngine({ extract: () => ({ status: 422, body: { detail: ["no text found in the file (a scanned PDF has none)"] } }) });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    const file = new File(["%PDF-1.4"], "스캔본.pdf", { type: "application/pdf" });
    await userEvent.upload(fileInput(), file);
    expect(await screen.findByText("글자를 찾지 못했어요. 스캔한 PDF는 글자가 없어서 쓸 수 없어요.")).toBeInTheDocument();
  });

  it("직접 쓰기로 문서를 만들고 이름·본문을 고칠 수 있다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    await userEvent.click(screen.getByRole("button", { name: "직접 쓰기" }));
    await userEvent.type(screen.getByLabelText("이름"), "새 문서");
    await userEvent.type(screen.getByLabelText("본문"), "내용입니다");
    expect(await screen.findByText("5자 · 내용입니다")).toBeInTheDocument();
  });

  it("확인해야만 문서를 지운다", async () => {
    kbEngine();
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await userEvent.click(await screen.findByText("안내문"));
    await userEvent.click(screen.getByRole("button", { name: "문서 삭제" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByText("안내문")).toBeInTheDocument();
    vi.stubGlobal("confirm", vi.fn(() => true));
    await userEvent.click(screen.getByRole("button", { name: "문서 삭제" }));
    await waitFor(() => expect(screen.queryByText("안내문")).toBeNull());
  });
});

describe("색인 만들기", () => {
  it("저장 안 된 변경이 있으면 색인 만들기가 꺼지고 이유를 보여준다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.type(await screen.findByLabelText("FAQ 1 질문"), "!");
    await userEvent.click(screen.getByRole("button", { name: "버전" }));
    expect(await screen.findByRole("button", { name: "색인 만들기" })).toBeDisabled();
    expect(screen.getByText("저장 안 된 변경이 있어요. 먼저 저장해 주세요.")).toBeInTheDocument();
  });

  it("색인을 만들면 완료 메시지를 보여주고 버전 목록을 새로고친다", async () => {
    let versionReads = 0;
    kbEngine({
      versions: () => {
        versionReads += 1;
        return { body: { bot: "sample", live: null, versions: versionReads > 1 ? [VERSION] : [] } };
      },
      buildResult: { version: VERSION.version, number: 1, faq: 1, chunks: 2 },
    });
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByRole("button", { name: "버전" }));
    expect(await screen.findByText("아직 만든 색인이 없어요.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "색인 만들기" }));
    expect(await screen.findByText("v1 색인 완료 · FAQ 1개 · 조각 2개")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "v1" })).toBeInTheDocument();
  });

  it("색인 실패를 이유와 함께 보여준다", async () => {
    kbEngine({ buildError: { kind: "invalid_draft", detail: "the knowledge base is invalid", errors: ["faq.0.question: must not be blank"] } });
    renderKnowledge();
    await screen.findByLabelText("FAQ 1 질문");
    await userEvent.click(screen.getByRole("button", { name: "버전" }));
    await userEvent.click(screen.getByRole("button", { name: "색인 만들기" }));
    expect(await screen.findByText("지식베이스에 고칠 곳이 있어 색인을 만들지 못했어요.")).toBeInTheDocument();
    expect(screen.getByText("FAQ 1 질문: must not be blank")).toBeInTheDocument();
  });
});

describe("버전", () => {
  it("버전 목록과 조각 미리보기를 보여주고, 긴 본문은 더 보기로 펼친다", async () => {
    const longBody = "문장입니다. ".repeat(30);
    kbEngine({
      versions: () => ({ body: { bot: "sample", live: VERSION.version, versions: [{ ...VERSION, live: true }] } }),
      entries: () => ({
        body: {
          bot: "sample", version: VERSION.version,
          entries: [
            { id: "faq_1", kind: "faq", title: "영업 시간이 어떻게 되나요?", body: "평일 9시부터 6시까지예요.", source: "" },
            { id: "doc_1#0", kind: "doc", title: "안내문 - 섹션", body: longBody, source: "안내문" },
          ],
        },
      }),
    });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "버전" }));
    const row = await screen.findByRole("button", { name: "v1" });
    expect(within(row.closest("tr") as HTMLElement).getByText("라이브")).toBeInTheDocument();
    await userEvent.click(row);
    expect(await screen.findByText("평일 9시부터 6시까지예요.")).toBeInTheDocument();
    expect(screen.getByText("출처: 안내문")).toBeInTheDocument();
    expect(screen.getByText(`${longBody.slice(0, 200)}…`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(screen.getByText(longBody.trim())).toBeInTheDocument();
  });
});

describe("검색 테스트", () => {
  it("색인이 없으면 안내한다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    expect(await screen.findByText("아직 색인이 없어요. 버전 탭에서 먼저 색인을 만들어 주세요.")).toBeInTheDocument();
  });

  it("검색하면 답과 후보 목록을 보여준다", async () => {
    const { searches } = kbEngine({
      versions: () => ({ body: { bot: "sample", live: null, versions: [VERSION] } }),
      search: () => ({
        body: {
          bot: "sample", version: VERSION.version, judge: "cosine", threshold: 0.5, exact: false,
          answer: { text: "평일 9시부터 6시까지예요.", replies: [], items: ["faq_1"] },
          candidates: [
            { id: "faq_1", kind: "faq", title: "영업 시간이 어떻게 되나요?", cosine: 0.912, score: 0.834, passed: true },
            { id: "doc_1#0", kind: "doc", title: "안내문 - 섹션", cosine: 0.221, score: 0.034, passed: false },
          ],
        },
      }),
    });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "영업 시간 알려줘");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("평일 9시부터 6시까지예요.")).toBeInTheDocument();
    expect(screen.getByText("판단: cosine · 기준 0.50")).toBeInTheDocument();
    expect(screen.getByText("0.912")).toBeInTheDocument();
    expect(screen.getByText("0.834")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(searches[0]).toEqual({ query: "영업 시간 알려줘", version: VERSION.version });
  });

  it("답하지 않으면 폴백 안내를 보여준다", async () => {
    kbEngine({
      versions: () => ({ body: { bot: "sample", live: null, versions: [VERSION] } }),
      search: () => ({
        body: {
          bot: "sample", version: VERSION.version, judge: "cosine", threshold: 0.5, exact: false, answer: null,
          candidates: [{ id: "doc_1#0", kind: "doc", title: "안내문 - 섹션", cosine: 0.1, score: 0.02, passed: false }],
        },
      }),
    });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "아무 말");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("답하지 않아요 (폴백으로 가요)")).toBeInTheDocument();
  });

  it("409면 먼저 색인을 만들라고 안내한다", async () => {
    kbEngine({ versions: () => ({ body: { bot: "sample", live: null, versions: [VERSION] } }) }); // default search: 409
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "질문");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("아직 색인이 없어요. 버전 탭에서 먼저 색인을 만들어 주세요.")).toBeInTheDocument();
  });
});


describe("화면을 떠났다 와도", () => {
  it("저장하지 않은 편집이 남아 있다", async () => {
    kbEngine();
    const client = createQueryClient();
    const first = renderKnowledge(client);
    const q = await screen.findByLabelText("FAQ 1 질문");
    await userEvent.type(q, " 주말도요?");
    first.unmount();
    renderKnowledge(client);
    expect(await screen.findByLabelText("FAQ 1 질문")).toHaveValue("영업 시간이 어떻게 되나요? 주말도요?");
    expect(screen.getByText("지식베이스에 저장 안 된 변경이 있어요")).toBeInTheDocument();
  });

  it("탭을 바꿔도 색인 작업 결과를 계속 보여준다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.click(await screen.findByRole("button", { name: "버전" }));
    await userEvent.click(await screen.findByRole("button", { name: "색인 만들기" }));
    expect(await screen.findByText("v1 색인 완료 · FAQ 1개 · 조각 2개")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "FAQ" }));
    await userEvent.click(screen.getByRole("button", { name: "버전" }));
    expect(await screen.findByText("v1 색인 완료 · FAQ 1개 · 조각 2개")).toBeInTheDocument();
  });
});


describe("리뷰 후 고친 것", () => {
  it("파일을 읽는 동안 고친 내용은 남고, 그동안 파일 입력은 꺼진다", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    kbEngine({ extract: async () => { await gate; return { body: { text: "나중에 도착한 글이에요." } }; } });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    await userEvent.upload(fileInput(), new File(["x"], "늦은.txt", { type: "text/plain" }));
    expect(fileInput()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "FAQ" }));
    await userEvent.type(screen.getByLabelText("FAQ 1 질문"), " 주말은요?");
    release();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    expect(await screen.findByText("늦은.txt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "FAQ" }));
    expect(screen.getByLabelText("FAQ 1 질문")).toHaveValue("영업 시간이 어떻게 되나요? 주말은요?");
  });

  it("10MB가 넘는 파일은 엔진에 보내지 않고 안내한다", async () => {
    const { uploads } = kbEngine();
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    const big = new File(["x"], "큰.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    await userEvent.upload(fileInput(), big);
    expect(await screen.findByText("10MB가 넘는 파일은 올릴 수 없어요.")).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
  });

  it("직접 쓴 빈 문서에는 색인을 만들 수 없다고 알린다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await screen.findByText("안내문");
    await userEvent.click(screen.getByRole("button", { name: "직접 쓰기" }));
    expect(await screen.findAllByText("이름이 비어 있으면 색인을 만들 수 없어요.")).toHaveLength(2); // list + editor
    await userEvent.type(screen.getByLabelText("이름"), "새 문서");
    expect(await screen.findAllByText("본문이 비어 있으면 색인을 만들 수 없어요.")).toHaveLength(2);
  });

  it("428(다른 곳에서 먼저 만듦)도 다시 불러오라고 안내한다", async () => {
    kbEngine({
      draft: () => ({ status: 404, body: { detail: "'sample' has no knowledge base" } }),
      put: () => ({ status: 428, body: { detail: "send the knowledge base's ETag in If-Match" } }),
    });
    renderKnowledge();
    await userEvent.click(await screen.findByRole("button", { name: "FAQ 추가" }));
    await userEvent.type(screen.getByLabelText("FAQ 1 질문"), "질문");
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    expect(await screen.findByText(/다른 곳에서 지식베이스가 바뀌었어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
  });

  it("변경 취소는 저장된 내용으로 되돌린다", async () => {
    kbEngine();
    renderKnowledge();
    await userEvent.type(await screen.findByLabelText("FAQ 1 질문"), "!!");
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 변경 취소" }));
    expect(screen.getByLabelText("FAQ 1 질문")).toHaveValue("영업 시간이 어떻게 되나요?");
    expect(screen.getByText("지식베이스 변경 없음")).toBeInTheDocument();
  });

  it("검색 버전을 바꾸면 이전 결과를 지우고, 쓸 수 없는 버전·없는 버전을 구별해 알린다", async () => {
    const V2 = { ...VERSION, version: "2b3c4d5e6f70", number: 2 };
    let reply: { status?: number; body: unknown } = {
      body: { bot: "sample", version: V2.version, judge: "cosine", threshold: 0.5, exact: false,
              answer: { text: "평일 9시부터 6시까지예요.", replies: [], items: ["faq_1"] }, candidates: [] },
    };
    kbEngine({ versions: () => ({ body: { bot: "sample", live: null, versions: [V2, VERSION] } }), search: () => reply });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "영업 시간");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("평일 9시부터 6시까지예요.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("버전"), VERSION.version);
    expect(screen.queryByText("평일 9시부터 6시까지예요.")).toBeNull();
    reply = { status: 409, body: { detail: { detail: "the knowledge base cannot be used here", errors: ["hashes to x"] } } };
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("이 버전은 지금 쓸 수 없어요. 색인을 다시 만들어 주세요. (hashes to x)")).toBeInTheDocument();
    reply = { status: 404, body: { detail: "unknown knowledge-base version: x" } };
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("그런 버전이 없어요. 목록을 새로 고쳐 주세요.")).toBeInTheDocument();
  });
});

describe("엔진 한도", () => {
  it("입력칸이 엔진이 받는 길이까지만 받는다", async () => {
    kbEngine();
    renderKnowledge();
    expect(await screen.findByLabelText("FAQ 1 질문")).toHaveAttribute("maxLength", "300");
    expect(screen.getByLabelText("FAQ 1 답")).toHaveAttribute("maxLength", "2000");
    await userEvent.click(screen.getByRole("button", { name: "문서" }));
    await userEvent.click(await screen.findByText("안내문"));
    expect(screen.getByLabelText("이름")).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText("본문")).toHaveAttribute("maxLength", "200000");
  });
});


describe("생성형 답변 (E-F)", () => {
  it("켜면 settings.generate를 보내고, 끄면 키를 지워 원래대로 돌아간다", async () => {
    const { puts } = kbEngine({ llm: () => ({ body: { configured: true, model: "qwen3-8b", ok: true, ms: 420, error: null } }) });
    renderKnowledge();
    const toggle = await screen.findByLabelText(/생성형 답변/);
    expect(await screen.findByText(/연결됨: qwen3-8b \(420ms\)/)).toBeInTheDocument();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByLabelText(/생성형 답변/));
    expect(screen.getByText("지식베이스 변경 없음")).toBeInTheDocument(); // on then off before saving: nothing changed
    await userEvent.click(screen.getByLabelText(/생성형 답변/));
    await userEvent.click(screen.getByRole("button", { name: "지식베이스 저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0]?.body.settings as Record<string, unknown>).generate).toBe(true);
  });

  it("답안 추천형에서는 끌 수 없게 꺼져 있다", async () => {
    kbEngine({ draft: () => ({ body: { ...structuredClone(DOC), settings: { mode: "suggest", suggest_text: "골라 주세요" } }, headers: { ETag: '"1"' } }) });
    renderKnowledge();
    expect(await screen.findByLabelText(/생성형 답변/)).toBeDisabled();
    expect(screen.getByText(/즉문즉답형에서만 쓸 수 있어요/)).toBeInTheDocument();
  });

  it("LLM이 없거나 답하지 않으면 그렇게 알린다", async () => {
    kbEngine();
    const first = renderKnowledge();
    expect(await screen.findByText(/이 엔진에는 LLM이 연결되어 있지 않아요/)).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();
    kbEngine({ llm: () => ({ body: { configured: true, model: "qwen3-8b", ok: false, ms: null, error: "cannot reach the LLM server" } }) });
    renderKnowledge();
    expect(await screen.findByText(/LLM이 답하지 않아요: cannot reach the LLM server\. 그동안은 찾은 자료 원문으로 답해요/)).toBeInTheDocument();
  });

  it("검색 테스트가 생성 결과(모델·시간·처리)를 보여준다", async () => {
    kbEngine({
      versions: () => ({ body: { bot: "sample", live: null, versions: [VERSION] } }),
      search: () => ({ body: {
        bot: "sample", version: VERSION.version, judge: "cosine", threshold: 0.5, exact: false, answer: null, candidates: [],
        generated: { model: "qwen3-8b", ms: 812, used: ["faq_1"], outcome: "unsupported_number" },
      } }),
    });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "영업 시간");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("생성형 답변: qwen3-8b · 812ms · 자료에 없는 숫자가 있어 버리고 답하지 않아요")).toBeInTheDocument();
    expect(screen.getByText("답하지 않아요 (폴백으로 가요)")).toBeInTheDocument();
  });

  it("LLM이 제때 답하지 않으면 찾은 자료 원문으로 답한다고 보여준다", async () => {
    kbEngine({
      versions: () => ({ body: { bot: "sample", live: null, versions: [VERSION] } }),
      search: () => ({ body: {
        bot: "sample", version: VERSION.version, judge: "cosine", threshold: 0.5, exact: false,
        answer: { text: "평일 9시부터 6시까지예요.", replies: [], items: ["faq_1"] }, candidates: [],
        generated: { model: "qwen3-8b", ms: 3500, used: ["faq_1"], outcome: "timeout" },
      } }),
    });
    renderKnowledge();
    await userEvent.click(screen.getByRole("button", { name: "검색 테스트" }));
    await userEvent.type(await screen.findByLabelText("검색어"), "영업 시간");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("생성형 답변: qwen3-8b · 3500ms · 시간 안에 오지 않아 찾은 자료 원문으로 답해요")).toBeInTheDocument();
    expect(screen.getByText("평일 9시부터 6시까지예요.")).toBeInTheDocument();
  });
});
