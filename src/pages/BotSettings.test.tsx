import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeEngine, headerOf, renderAt, type Reply, SAMPLE } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

interface Options {
  token?: string;
  label?: unknown;
  errors?: string[]; // draft problems the engine reports on save (valid: false)
  putReplies?: Reply[]; // replies for the first PUTs, before the engine behaves normally
  failDraftAfter?: number; // GET draft answers 500 after this many successful reads
}

/** A fake engine holding one draft, with the engine's ETag rules. */
function engineWithDraft({ token, label: initial = "샘플 봇", errors = [], putReplies = [], failDraftAfter }: Options = {}) {
  let revision = 4;
  let label: unknown = initial;
  let reads = 0;
  const pending = [...putReplies];
  const auth = { token }; // read on every request: a test can turn the token on midway
  const fetchMock = fakeEngine({
    "GET /v1/builder/bots": () => ({ body: { bots: [{ ...SAMPLE, label: typeof label === "string" ? label : "", draft_revision: revision }] } }),
    "GET /v1/builder/bots/sample/draft": () => {
      reads += 1;
      if (failDraftAfter !== undefined && reads > failDraftAfter) return { status: 500, body: { detail: "internal error" } };
      return { body: { id: "sample", label, intents: {} }, headers: { ETag: `"${revision}"` } };
    },
    "PUT /v1/builder/bots/sample/draft": (init) => {
      const canned = pending.shift();
      if (canned) return canned;
      if (headerOf(init, "If-Match") !== `"${revision}"`) return { status: 412, body: { detail: "moved", revision } };
      revision += 1;
      label = (JSON.parse(String(init.body)) as { label: string }).label;
      return { body: { bot: "sample", version: "bbbbbbbbbbbb", revision, valid: errors.length === 0, errors, warnings: [] } };
    },
  }, auth);
  return { fetchMock, auth, bump: (newLabel: string) => { revision += 1; label = newLabel; } };
}

const puts = (fetchMock: ReturnType<typeof engineWithDraft>["fetchMock"]) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => init);

async function rename(to: string) {
  const input = await screen.findByLabelText("봇 이름");
  await userEvent.clear(input);
  await userEvent.type(input, to);
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
}

describe("bot settings", () => {
  it("saves a new name over the draft it read and keeps focus in the field", async () => {
    const { fetchMock } = engineWithDraft();
    renderAt("/bots/sample/settings");
    expect(screen.getByRole("status", { name: "" })).toBeInTheDocument();
    const input = await screen.findByLabelText("봇 이름");
    expect(input).toHaveValue("샘플 봇");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled(); // nothing changed yet
    await rename("고객 상담 봇 ");
    await waitFor(() => expect(screen.getByText("저장했어요 · 리비전 5")).toBeInTheDocument());
    const [put] = puts(fetchMock);
    expect(headerOf(put, "If-Match")).toBe('"4"');
    expect(JSON.parse(String(put?.body))).toEqual({ id: "sample", label: "고객 상담 봇", intents: {} }); // trimmed, rest kept
    expect(screen.getByLabelText("봇 이름")).toHaveValue("고객 상담 봇");
    expect(screen.getByLabelText("봇 이름")).toHaveFocus(); // the form remounted; the keyboard user stays in place
  });

  it("sends one save for a double submit and the new ETag for the next save", async () => {
    const { fetchMock } = engineWithDraft();
    renderAt("/bots/sample/settings");
    const input = await screen.findByLabelText("봇 이름");
    await userEvent.type(input, "!");
    await userEvent.dblClick(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장했어요 · 리비전 5");
    expect(puts(fetchMock)).toHaveLength(1);
    await rename("두 번째");
    await screen.findByText("저장했어요 · 리비전 6");
    expect(headerOf(puts(fetchMock)[1], "If-Match")).toBe('"5"');
  });

  it("explains a conflict, reloads the newer draft, and saves on top of it", async () => {
    const { fetchMock, bump } = engineWithDraft();
    renderAt("/bots/sample/settings");
    await screen.findByLabelText("봇 이름");
    bump("다른 탭의 이름"); // someone saved meanwhile (revision 5)
    await rename("내 이름");
    expect(await screen.findByRole("heading", { name: "다른 곳에서 먼저 저장했어요" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "최신 초안 다시 불러오기" }));
    await waitFor(() => expect(screen.getByLabelText("봇 이름")).toHaveValue("다른 탭의 이름"));
    expect(screen.queryByRole("heading", { name: "다른 곳에서 먼저 저장했어요" })).not.toBeInTheDocument();
    await rename("내 이름");
    await screen.findByText("저장했어요 · 리비전 6");
    expect(headerOf(puts(fetchMock).at(-1), "If-Match")).toBe('"5"');
  });

  it("lists problems the draft already had, and the status survives the reload", async () => {
    engineWithDraft({ errors: ["scenario check_weather step 3: unknown response 'nope'"] });
    renderAt("/bots/sample/settings");
    await rename("샘플 봇!");
    expect(await screen.findByRole("heading", { name: "초안에 배포 전에 고칠 부분이 1개 있어요" })).toBeInTheDocument();
    expect(screen.getByText("scenario check_weather step 3: unknown response 'nope'")).toBeInTheDocument();
    expect(screen.getByText("저장했어요 · 리비전 5")).toBeInTheDocument();
  });

  it("shows engine errors while saving and retries the save", async () => {
    engineWithDraft({ putReplies: [{ status: 500, body: { detail: "internal error" } }] });
    renderAt("/bots/sample/settings");
    await rename("샘플 봇!");
    expect(await screen.findByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("저장했어요 · 리비전 5")).toBeInTheDocument();
  });

  it("explains requests the engine refuses, without a pointless retry", async () => {
    engineWithDraft({ putReplies: [
      { status: 422, body: { detail: ["the document's id must be 'sample'"] } },
      { status: 428, body: { detail: "send the draft's ETag in If-Match" } },
    ] });
    renderAt("/bots/sample/settings");
    await rename("하나");
    expect(await screen.findByRole("heading", { name: "엔진이 이 내용을 받지 않았어요" })).toBeInTheDocument();
    expect(screen.getByText("the document's id must be 'sample'")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    await rename("둘");
    expect(await screen.findByRole("heading", { name: "빌더가 잘못된 요청을 보냈어요" })).toBeInTheDocument();
  });

  it("asks for the token when a save is refused, then saves", async () => {
    const { fetchMock, auth } = engineWithDraft();
    renderAt("/bots/sample/settings");
    await rename("새 이름");
    await screen.findByText("저장했어요 · 리비전 5");
    auth.token = "s3cret"; // the engine now requires a token
    await rename("또 새 이름");
    const tokenField = await screen.findByLabelText("관리자 토큰");
    expect(tokenField.closest("form")?.parentElement?.closest("form")).toBeNull(); // not nested in the settings form
    await userEvent.type(tokenField, "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "토큰 저장" }));
    expect(await screen.findByText("저장했어요 · 리비전 6")).toBeInTheDocument();
    expect(headerOf(puts(fetchMock).at(-1), "Authorization")).toBe("Bearer s3cret");
    expect(screen.getByLabelText("봇 이름")).toHaveValue("또 새 이름");
  });

  it("keeps the form when a later reload fails", async () => {
    engineWithDraft({ failDraftAfter: 1 });
    renderAt("/bots/sample/settings");
    await rename("새 이름"); // the save succeeds, the reload after it fails
    expect(await screen.findByRole("heading", { name: "최신 초안을 불러오지 못했어요" })).toBeInTheDocument();
    expect(screen.getByLabelText("봇 이름")).toBeInTheDocument();
  });

  it("treats a non-text label as empty and says when the bot has no draft", async () => {
    engineWithDraft({ label: 5 });
    const first = renderAt("/bots/sample/settings");
    expect(await screen.findByLabelText("봇 이름")).toHaveValue("");
    first.unmount();
    vi.unstubAllGlobals();
    fakeEngine({ "GET /v1/builder/bots": () => ({ body: { bots: [] } }) });
    renderAt("/bots/ghost/settings");
    expect(await screen.findByRole("heading", { name: "찾을 수 없어요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });
});
