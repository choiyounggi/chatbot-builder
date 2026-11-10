import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { DraftProvider } from "../draft/DraftContext";
import { fakeEngine, type Handler } from "../test/engine";
import { Edits } from "./Edits";

afterEach(() => vi.unstubAllGlobals());

function renderEdits() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <DraftProvider botId="sample">
        <Edits />
      </DraftProvider>
    </Providers>,
  );
}

const DRAFT_ROUTE: Handler = () => ({ body: { id: "sample", label: "샘플", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } });

function engine(routes: Record<string, Handler>) {
  return fakeEngine({ "GET /v1/builder/bots/sample/draft": DRAFT_ROUTE, ...routes });
}

describe("작업이력", () => {
  it("리비전·시각과 각 변경을 한글 한 줄씩 보여줘요 (블록·의도·시스템·봇)", async () => {
    engine({
      "GET /v1/builder/bots/sample/edits?limit=50": () => ({
        body: {
          bot: "sample",
          items: [{
            revision: 5, saved_at: "2026-11-10T09:00:00+00:00",
            changes: [
              { area: "block", action: "changed", id: "check_weather", label: "날씨 안내", examples_added: null, examples_removed: null },
              { area: "intent", action: "changed", id: "weather", label: "", examples_added: 2, examples_removed: 1 },
              { area: "system", action: "added", id: "welcome", label: "", examples_added: null, examples_removed: null },
              { area: "bot", action: "changed", id: "label", label: "이름", examples_added: null, examples_removed: null },
            ],
          }],
        },
      }),
    });
    renderEdits();
    expect(await screen.findByText(/^리비전 5 · .+/)).toBeInTheDocument();
    expect(screen.getByText("블록 ‘날씨 안내’(check_weather) 수정")).toBeInTheDocument();
    expect(screen.getByText("의도 weather 수정 · 예문 +2 −1")).toBeInTheDocument();
    expect(screen.getByText("시스템 블록 추가")).toBeInTheDocument();
    expect(screen.getByText("봇 이름 수정")).toBeInTheDocument();
  });

  it("label이 비어 있으면 id로, 예문 수가 한쪽만 있으면 0으로 채워요", async () => {
    engine({
      "GET /v1/builder/bots/sample/edits?limit=50": () => ({
        body: {
          bot: "sample",
          items: [{
            revision: 9, saved_at: "2026-11-10T09:00:00+00:00",
            changes: [
              { area: "block", action: "removed", id: "old_block", label: "", examples_added: null, examples_removed: null },
              { area: "entity", action: "added", id: "place_region", label: "", examples_added: null, examples_removed: null },
              { area: "response", action: "changed", id: "r1", label: "", examples_added: null, examples_removed: null },
              { area: "settings", action: "changed", id: "max_attempts", label: "", examples_added: null, examples_removed: null },
              { area: "intent", action: "changed", id: "bye", label: "", examples_added: 3, examples_removed: null },
            ],
          }],
        },
      }),
    });
    renderEdits();
    expect(await screen.findByText("블록 old_block 삭제")).toBeInTheDocument();
    expect(screen.getByText("엔티티 place_region 추가")).toBeInTheDocument();
    expect(screen.getByText("응답 r1 수정")).toBeInTheDocument();
    expect(screen.getByText("설정 max_attempts 수정")).toBeInTheDocument();
    expect(screen.getByText("의도 bye 수정 · 예문 +3 −0")).toBeInTheDocument();
  });

  it("기록이 없으면 안내해요", async () => {
    engine({ "GET /v1/builder/bots/sample/edits?limit=50": () => ({ body: { bot: "sample", items: [] } }) });
    renderEdits();
    expect(await screen.findByText("아직 저장한 기록이 없어요.")).toBeInTheDocument();
  });

  it("못 불러오면 오류를 보여줘요", async () => {
    engine({ "GET /v1/builder/bots/sample/edits?limit=50": () => ({ status: 500, body: { detail: "internal error" } }) });
    renderEdits();
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
  });

  it("'더 보기'를 누르면 더 많이 불러오고, 전부 불러오면 버튼이 사라져요", async () => {
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({
      revision: 1000 - offset - i,
      saved_at: "2026-11-10T00:00:00+00:00",
      changes: [{ area: "block" as const, action: "changed" as const, id: `b${offset + i}`, label: "", examples_added: null, examples_removed: null }],
    }));
    engine({
      "GET /v1/builder/bots/sample/edits?limit=50": () => ({ body: { bot: "sample", items: page(50, 0) } }),
      "GET /v1/builder/bots/sample/edits?limit=100": () => ({ body: { bot: "sample", items: page(70, 0) } }), // fewer than 70 total
    });
    renderEdits();
    await screen.findByText("블록 b0 수정");
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await waitFor(() => expect(screen.getByText("블록 b69 수정")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });
});
