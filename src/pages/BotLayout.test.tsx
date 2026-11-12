import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeEngine, renderAt, SAMPLE } from "../test/engine";

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

function engine() {
  fakeEngine({
    "GET /v1/builder/bots": () => ({ body: { bots: [SAMPLE] } }),
    "GET /v1/builder/bots/sample/draft": () => ({ body: { id: "sample", label: "샘플 봇" }, headers: { ETag: '"4"' } }),
  });
}

describe("bot shell", () => {
  it("opens on settings and lists every section in the rail", async () => {
    engine();
    renderAt("/bots/sample");
    expect(await screen.findByRole("heading", { name: "설정" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "봇 메뉴" });
    const names = Array.from(rail.querySelectorAll("a")).map((a) => a.textContent);
    expect(names).toEqual(["시나리오", "스킬", "지식베이스", "학습", "분석", "배포", "작업이력", "머신러닝", "웹 채팅", "설정"]);
    expect(screen.getByRole("link", { name: "설정" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("샘플 봇", { selector: "strong" })).toBeInTheDocument();
  });

  it("opens every section's own screen (the last one, 분석, included)", async () => {
    engine();
    renderAt("/bots/sample/settings");
    await userEvent.click(await screen.findByRole("link", { name: "분석" }));
    expect(screen.getByRole("heading", { name: "분석", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/봇테스트 대화는 세지 않아요/)).toBeInTheDocument();
  });

  it("toggles the entity and bot test panels", async () => {
    engine();
    renderAt("/bots/sample/settings");
    const entities = await screen.findByRole("button", { name: "엔티티" });
    await userEvent.click(entities);
    expect(entities).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "엔티티" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "봇테스트" }));
    expect(screen.getByRole("complementary", { name: "봇테스트" })).toBeInTheDocument();
    expect(entities).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "봇테스트 닫기" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "봇테스트" })).toHaveFocus(); // focus goes back to the opener
    await userEvent.click(entities);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeInTheDocument(); // Escape needs focus inside the panel
    await userEvent.click(screen.getByRole("button", { name: "엔티티 닫기" }));
    await userEvent.click(entities);
    screen.getByRole("button", { name: "엔티티 닫기" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(entities).toHaveFocus();
  });

  it("offers a skip link to the content", async () => {
    engine();
    renderAt("/bots/sample/settings");
    expect(await screen.findByRole("link", { name: "본문으로 건너뛰기" })).toHaveAttribute("href", "#content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "content");
  });

  it("cycles the theme from the top bar", async () => {
    engine();
    renderAt("/");
    const toggle = await screen.findByRole("button", { name: "테마 · 시스템" });
    await userEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("button", { name: "테마 · 라이트" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("shows a way back for unknown addresses", () => {
    engine();
    renderAt("/nowhere");
    expect(screen.getByRole("heading", { name: "없는 주소예요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "봇 목록으로 돌아가기" })).toHaveAttribute("href", "/");
  });
});

describe("error boundary", () => {
  it("shows a way out instead of a blank page when rendering fails", async () => {
    const { render } = await import("@testing-library/react");
    const { ErrorBoundary } = await import("../App");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("render bug");
    }
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole("heading", { name: "화면을 그리다가 문제가 생겼어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "처음으로" })).toHaveAttribute("href", "/");
    quiet.mockRestore();
  });
});
