import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createQueryClient, Providers } from "../App";
import { ApiError } from "../api/client";
import { ErrorNotice } from "./ErrorNotice";

function renderNotice(error: unknown) {
  return render(
    <Providers client={createQueryClient()}>
      <MemoryRouter>
        <ErrorNotice error={error} onRetry={() => {}} />
      </MemoryRouter>
    </Providers>,
  );
}

describe("ErrorNotice", () => {
  it("explains a bot waiting for deletion, with a link to the list and no retry button", () => {
    renderNotice(new ApiError(409, "the bot is waiting to be deleted; restore it first"));
    expect(screen.getByRole("heading", { name: "이 봇은 삭제 대기 중이에요." })).toBeInTheDocument();
    expect(screen.getByText("봇 목록에서 되살린 뒤 고칠 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "봇 목록으로" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("falls back to the generic notice for an unrelated 409", () => {
    renderNotice(new ApiError(409, "already waiting for deletion"));
    expect(screen.getByRole("heading", { name: "요청을 처리하지 못했어요" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("shows the HTTP status for an error it does not special-case", () => {
    renderNotice(new ApiError(500, "boom"));
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
  });
});
