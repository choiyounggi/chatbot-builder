// B9: 웹 채팅 — allowed sites, the chat window's look, the code to embed it (engine E-G, chatbot-widget).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, Providers } from "../App";
import { DraftProvider } from "../draft/DraftContext";
import { fakeEngine, type Handler } from "../test/engine";
import { WebChat } from "./WebChat";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const B = "/v1/builder/bots/sample";
const SAVED = { bot: "sample", allowed_origins: ["https://shop.example"], title: null, color: "#2563EB", placeholder: "메시지를 입력하세요" };

function engine(options: { get?: Handler; put?: Handler } = {}) {
  const puts: Record<string, unknown>[] = [];
  fakeEngine({
    [`GET ${B}/draft`]: () => ({ body: { id: "sample", label: "샘플 봇", scenarios: {}, responses: {} }, headers: { ETag: '"1"' } }),
    [`GET ${B}/web`]: options.get ?? (() => ({ body: SAVED })),
    [`PUT ${B}/web`]: async (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      puts.push(body);
      return options.put ? await options.put(init) : { body: { bot: "sample", ...body } };
    },
  });
  return puts;
}

function renderWeb() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(<Providers client={client}><MemoryRouter><DraftProvider botId="sample"><WebChat /></DraftProvider></MemoryRouter></Providers>);
}

describe("WebChat", () => {
  it("shows what is saved, the bot's name as the default title, and saves normalised settings", async () => {
    const puts = engine();
    renderWeb();
    const origins = await screen.findByLabelText("허용 도메인");
    expect(origins).toHaveValue("https://shop.example");
    expect(await screen.findByText("비워 두면 봇 이름(‘샘플 봇’)이 보여요.")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "웹 채팅 저장" });
    expect(save).toBeDisabled(); // nothing changed
    await userEvent.type(origins, "\nHTTPS://APP.example:443");
    await userEvent.type(screen.getByLabelText("채팅창 제목"), "  상담봇 ");
    await userEvent.clear(screen.getByLabelText("입력칸 안내 문구"));
    await userEvent.type(screen.getByLabelText("입력칸 안내 문구"), "무엇이 궁금하세요?");
    await userEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ allowed_origins: ["https://shop.example", "https://app.example"], title: "상담봇", color: "#2563EB",
                              placeholder: "무엇이 궁금하세요?" });
    expect(await screen.findByText("저장했어요. 바로 적용돼요.")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "웹 채팅 저장" })).toBeDisabled();
  });

  it("does not save bad, duplicate or missing values and says what to fix", async () => {
    const puts = engine();
    renderWeb();
    const origins = await screen.findByLabelText("허용 도메인");
    await userEvent.type(origins, "\nhttps://shop.example/path\nhttps://SHOP.example");
    await userEvent.clear(screen.getByLabelText("입력칸 안내 문구"));
    const listId = origins.getAttribute("aria-describedby")?.split(" ")[1] ?? "";
    const list = document.getElementById(listId) as HTMLElement;
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "‘https://shop.example/path’은(는) 주소 형식이 아니에요. https://example.com 처럼 경로 없이 써 주세요.",
      "‘https://shop.example’이(가) 두 번 있어요.",
      "입력칸 안내 문구를 써 주세요.",
    ]);
    expect(origins).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "웹 채팅 저장" })).toBeDisabled();
    expect(puts).toEqual([]);
  });

  it("an empty list is allowed (no site can embed) and the title can go back to the bot's name", async () => {
    const puts = engine({ get: () => ({ body: { ...SAVED, title: "옛 제목" } }) });
    renderWeb();
    await userEvent.clear(await screen.findByLabelText("허용 도메인"));
    await userEvent.clear(screen.getByLabelText("채팅창 제목"));
    await userEvent.click(screen.getByRole("button", { name: "웹 채팅 저장" }));
    await waitFor(() => expect(puts[0]).toMatchObject({ allowed_origins: [], title: null }));
  });

  it("shows the engine's refusal of a save, and a load that failed", async () => {
    engine({ put: () => ({ status: 409, body: { detail: "the bot is waiting to be deleted; restore it first" } }) });
    renderWeb();
    await userEvent.type(await screen.findByLabelText("채팅창 제목"), "x");
    await userEvent.click(screen.getByRole("button", { name: "웹 채팅 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/409|삭제|waiting/);
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    engine({ get: () => ({ status: 500, body: { detail: "internal error" } }) });
    renderWeb();
    expect(await screen.findByRole("button", { name: /다시/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("허용 도메인")).not.toBeInTheDocument();
  });

  it("builds the embed code from the addresses, remembers them, copies, and offers to allow the widget's own address", async () => {
    const puts = engine();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWeb();
    await screen.findByLabelText("허용 도메인");
    expect(screen.getByLabelText("웹사이트 코드")).toHaveTextContent("위젯 주소와 엔진 주소를 http(s) 주소로 넣으면 여기에 코드가 생겨요.");
    expect(screen.getByRole("button", { name: "웹사이트 코드 복사" })).toBeDisabled();
    expect(localStorage.getItem("chatbot-builder:web-urls")).toBeNull(); // nothing written until typed
    await userEvent.type(screen.getByLabelText("위젯 주소"), "chat.example"); // no scheme: not an address yet
    expect(screen.getByRole("button", { name: "웹사이트 코드 복사" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("위젯 주소"));
    await userEvent.type(screen.getByLabelText("위젯 주소"), "https://chat.example/w/?v=1#top");
    await userEvent.type(screen.getByLabelText("엔진 주소"), "https://api.example");
    expect(screen.getByLabelText("웹사이트 코드")).toHaveTextContent('<script src="https://chat.example/w/chatbot.js" data-engine="https://api.example" data-bot="sample" async></script>');
    expect(screen.getByLabelText("웹뷰 주소")).toHaveTextContent("https://chat.example/w/chat.html?engine=https%3A%2F%2Fapi.example&bot=sample&close=1");

    expect(JSON.parse(localStorage.getItem("chatbot-builder:web-urls") ?? "{}")).toEqual({ widget: "https://chat.example/w/?v=1#top", engine: "https://api.example" });
    await userEvent.click(screen.getByRole("button", { name: "웹사이트 코드 복사" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("chatbot.js"));
    expect(screen.getAllByRole("status").some((s) => s.textContent === "웹사이트 코드를 복사했어요.")).toBe(true);
    await userEvent.type(screen.getByLabelText("엔진 주소"), "/v2"); // the code changed: not copied yet
    expect(screen.getAllByRole("status").some((s) => s.textContent === "웹사이트 코드를 복사했어요.")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "허용 도메인에 추가" }));
    expect(screen.getByLabelText("허용 도메인")).toHaveValue("https://shop.example\nhttps://chat.example");
    expect(screen.queryByRole("button", { name: "허용 도메인에 추가" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "웹 채팅 저장" }));
    await waitFor(() => expect(puts[0]?.allowed_origins).toEqual(["https://shop.example", "https://chat.example"]));
  });

  it("fields wait while a save is on its way, and what the save sent becomes what is shown", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const puts = engine({ put: async (init) => { await gate; return { body: { bot: "sample", ...JSON.parse(String(init.body)) } }; } });
    renderWeb();
    await userEvent.type(await screen.findByLabelText("채팅창 제목"), "첫");
    await userEvent.click(screen.getByRole("button", { name: "웹 채팅 저장" }));
    expect(screen.getByLabelText("채팅창 제목")).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장하는 중…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByLabelText("채팅창 제목")).toBeEnabled());
    expect(screen.getByLabelText("채팅창 제목")).toHaveValue("첫");
    expect(puts).toHaveLength(1);
  });

  it("a change saved in another tab shows in the fields not edited here, and is not undone by this save", async () => {
    let origins = ["https://shop.example"];
    const puts = engine({ get: () => ({ body: { ...SAVED, allowed_origins: origins } }) });
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
    render(<Providers client={client}><MemoryRouter><DraftProvider botId="sample"><WebChat /></DraftProvider></MemoryRouter></Providers>);
    await userEvent.type(await screen.findByLabelText("채팅창 제목"), "새 제목");
    origins = ["https://shop.example", "https://other-tab.example"];
    await client.refetchQueries({ queryKey: ["web", "sample"] });
    await waitFor(() => expect(screen.getByLabelText("허용 도메인")).toHaveValue("https://shop.example\nhttps://other-tab.example"));
    expect(screen.getByLabelText("채팅창 제목")).toHaveValue("새 제목");
    await userEvent.click(screen.getByRole("button", { name: "웹 채팅 저장" }));
    await waitFor(() => expect(puts[0]).toMatchObject({ allowed_origins: origins, title: "새 제목" }));
  });

  it("typing a value back to what is saved means nothing changed", async () => {
    engine();
    renderWeb();
    const title = await screen.findByLabelText("채팅창 제목");
    await userEvent.type(title, "x");
    expect(screen.getByRole("button", { name: "웹 채팅 저장" })).toBeEnabled();
    await userEvent.clear(title);
    expect(screen.getByRole("button", { name: "웹 채팅 저장" })).toBeDisabled();
  });

  it("the same problem twice is listed twice", async () => {
    engine();
    renderWeb();
    await userEvent.type(await screen.findByLabelText("허용 도메인"), "\nfoo\nfoo");
    const list = screen.getByLabelText("허용 도메인").getAttribute("aria-describedby")?.split(" ")[1] ?? "";
    expect(document.getElementById(list)?.querySelectorAll("li")).toHaveLength(2);
  });

  it("says so when the clipboard cannot be used, and survives blocked storage", async () => {
    engine();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked"); });
    renderWeb();
    await userEvent.type(await screen.findByLabelText("위젯 주소"), "https://w.example");
    await userEvent.type(screen.getByLabelText("엔진 주소"), "https://e.example");
    await userEvent.click(screen.getByRole("button", { name: "웹뷰 주소 복사" }));
    expect(await screen.findByText("복사하지 못했어요. 위 글을 직접 선택해 복사해 주세요.")).toBeInTheDocument();
    setItem.mockRestore();
    getItem.mockRestore();
  });
});
