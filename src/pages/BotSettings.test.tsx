import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { botEngine, fakeEngine, renderAt } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

async function rename(to: string) {
  const input = await screen.findByLabelText("봇 이름");
  await userEvent.clear(input);
  await userEvent.type(input, to);
}

const saveButton = () => screen.getByRole("button", { name: "저장" });

describe("settings and the save bar", () => {
  it("saves the working copy with the ETag it read, then starts a test build", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/settings");
    expect(await screen.findByLabelText("봇 이름")).toHaveValue(String(state.doc.label));
    expect(saveButton()).toBeDisabled();
    await rename("고객 상담 봇");
    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();
    await userEvent.click(saveButton());
    await screen.findByText("저장했어요 · 리비전 5");
    expect(state.puts[0]?.etag).toBe('"4"');
    expect(state.puts[0]?.body.label).toBe("고객 상담 봇");
    expect(Object.keys(state.puts[0]?.body.scenarios as object)).toHaveLength(9); // the whole document, unchanged elsewhere
    await waitFor(() => expect(state.builds).toBe(1));
    expect(screen.getByLabelText("봇 이름")).toHaveValue("고객 상담 봇");
    expect(saveButton()).toBeDisabled();
  });

  it("discards unsaved changes", async () => {
    botEngine();
    renderAt("/bots/sample/settings");
    await rename("임시 이름");
    await userEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(screen.getByLabelText("봇 이름")).toHaveValue("샘플 봇");
    expect(screen.getByText("변경 없음")).toBeInTheDocument();
  });

  it("explains a conflict and reloads the newer draft", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/settings");
    await rename("내 이름");
    state.revision += 1; // someone saved meanwhile
    state.doc = { ...state.doc, label: "다른 탭의 이름" };
    await userEvent.click(saveButton());
    expect(await screen.findByRole("heading", { name: "다른 곳에서 먼저 저장했어요" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "최신 초안 다시 불러오기" }));
    await waitFor(() => expect(screen.getByLabelText("봇 이름")).toHaveValue("다른 탭의 이름"));
    await rename("내 이름");
    await userEvent.click(saveButton());
    await screen.findByText("저장했어요 · 리비전 6");
    expect(state.puts.at(-1)?.etag).toBe('"5"');
  });

  it("lists problems the saved draft has", async () => {
    botEngine({ errors: ["scenario check_weather step 3: unknown response 'nope'"] });
    renderAt("/bots/sample/settings");
    await rename("샘플 봇!");
    await userEvent.click(saveButton());
    expect(await screen.findByText("저장했지만 배포 전에 고칠 부분이 1개 있어요")).toBeInTheDocument();
    expect(screen.getByText("scenario check_weather step 3: unknown response 'nope'")).toBeInTheDocument();
  });

  it("retries a failed save and explains requests the engine refuses", async () => {
    const { state } = botEngine({ putReplies: [
      { status: 500, body: { detail: "internal error" } },
      { status: 422, body: { detail: ["the document's id must be 'sample'"] } },
    ] });
    renderAt("/bots/sample/settings");
    await rename("하나");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("heading", { name: "엔진이 이 내용을 받지 않았어요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    await userEvent.click(saveButton());
    await screen.findByText("저장했어요 · 리비전 5");
    expect(state.puts).toHaveLength(3);
  });

  it("asks for the token when a save is refused, then saves", async () => {
    const { auth, state } = botEngine();
    renderAt("/bots/sample/settings");
    await rename("새 이름");
    auth.token = "s3cret"; // the engine now requires a token
    await userEvent.click(saveButton());
    await userEvent.type(await screen.findByLabelText("관리자 토큰"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "토큰 저장" }));
    expect(await screen.findByText("저장했어요 · 리비전 5")).toBeInTheDocument();
    expect(state.doc.label).toBe("새 이름");
  });

  it("shows what was saved even when reloading afterwards fails, and saves again on top of it", async () => {
    const { state } = botEngine({ failDraftAfter: 1 });
    renderAt("/bots/sample/settings");
    await rename("새 이름");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("heading", { name: "최신 초안을 불러오지 못했어요" })).toBeInTheDocument();
    expect(screen.getByLabelText("봇 이름")).toHaveValue("새 이름"); // not the pre-save copy
    await rename("또 새 이름");
    await userEvent.click(saveButton());
    await screen.findByText("저장했어요 · 리비전 6");
    expect(state.puts.map((p) => p.etag)).toEqual(['"4"', '"5"']); // no false conflict
  });

  it("never overwrites a draft that changed elsewhere while editing, even after a reload", async () => {
    const { state } = botEngine();
    renderAt("/bots/sample/settings");
    await rename("내 이름");
    state.revision += 1; // someone saved meanwhile...
    state.doc = { ...state.doc, label: "다른 탭의 이름" };
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online")); // ...and a reconnect reloads the stored draft
    expect(await screen.findByRole("heading", { name: "다른 곳에서 초안이 바뀌었어요" })).toBeInTheDocument();
    expect(screen.getByLabelText("봇 이름")).toHaveValue("내 이름");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("heading", { name: "다른 곳에서 먼저 저장했어요" })).toBeInTheDocument();
    expect(state.puts[0]?.etag).toBe('"4"'); // sent the revision the edits started from
    expect(state.doc.label).toBe("다른 탭의 이름");
  });

  it("keeps edits made while a save is in flight", async () => {
    let release = () => {};
    const { state } = botEngine({ putGate: new Promise<void>((r) => { release = r; }) });
    renderAt("/bots/sample/settings");
    await rename("첫 번째");
    await userEvent.click(saveButton());
    await userEvent.type(screen.getByLabelText("봇 이름"), " 그리고 더");
    release();
    await screen.findByText("저장 안 된 변경이 있어요");
    expect(screen.getByLabelText("봇 이름")).toHaveValue("첫 번째 그리고 더");
    expect(state.doc.label).toBe("첫 번째");
    await userEvent.click(saveButton());
    await screen.findByText("저장했어요 · 리비전 6");
    expect(state.puts.at(-1)?.etag).toBe('"5"');
  });

  it("treats a non-text label as empty and explains a bot without a draft", async () => {
    botEngine({ doc: { id: "sample", label: 5, scenarios: {}, responses: {} } });
    const first = renderAt("/bots/sample/settings");
    expect(await screen.findByLabelText("봇 이름")).toHaveValue("");
    first.unmount();
    vi.unstubAllGlobals();
    fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [] } }) });
    renderAt("/bots/ghost/settings");
    expect(await screen.findByRole("heading", { name: "찾을 수 없어요" })).toBeInTheDocument();
  });
});
