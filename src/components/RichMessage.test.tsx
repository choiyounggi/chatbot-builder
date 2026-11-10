import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TestMessage } from "../api/types";
import { QuickReplies, RichMessage } from "./RichMessage";

const message = (extra: Partial<TestMessage>): TestMessage => ({ response: "r", text: "요약", quick_replies: [], type: "text", ...extra });

describe("RichMessage", () => {
  it("renders plain text when type is text, and when type is absent (an older engine)", () => {
    const { unmount } = render(<RichMessage message={message({ type: "text", text: "안녕하세요" })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
    unmount();
    const noType = { response: "r", text: "안녕", quick_replies: [] } as unknown as TestMessage; // old engine: no `type` field at all
    render(<RichMessage message={noType} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByText("안녕")).toBeInTheDocument();
  });

  it("renders a simple_image with lazy loading and alt text, and falls back to the label for a non-http URL", () => {
    const { unmount } = render(<RichMessage message={message({ type: "simple_image", simple_image: { alt_text: "고양이 사진", image_url: "https://example.com/cat.png" } })}
                                             interactive disabled={false} onAction={vi.fn()} />);
    const img = screen.getByRole("img", { name: "고양이 사진" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("src", "https://example.com/cat.png");
    unmount();
    render(<RichMessage message={message({ type: "simple_image", simple_image: { alt_text: "위험한 이미지", image_url: "javascript:alert(1)" } })}
                        interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("위험한 이미지")).toBeInTheDocument();
  });

  it("renders a basic_card's thumbnail, title, description and buttons", () => {
    render(<RichMessage message={message({
      type: "basic_card",
      basic_card: {
        thumbnail: { image_url: "https://example.com/t.png", alt_text: "썸네일", fixed_ratio: false },
        title: "상품 이름", description: "상품 설명",
        buttons: [{ action: "message", label: "자세히", message_text: "자세히 보기" }],
      },
    })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByRole("img", { name: "썸네일" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "상품 이름" })).toBeInTheDocument();
    expect(screen.getByText("상품 설명")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자세히" })).toBeInTheDocument();
  });

  it("renders a basic_card with only a thumbnail (no title, description or buttons)", () => {
    render(<RichMessage message={message({
      type: "basic_card",
      basic_card: { thumbnail: { image_url: "https://example.com/t.png", alt_text: "썸네일만", fixed_ratio: false } },
    })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByRole("img", { name: "썸네일만" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a list_card's header and items, linking an item that has link.web, and buttons below", () => {
    render(<RichMessage message={message({
      type: "list_card",
      list_card: {
        header: { title: "목록 제목" },
        items: [
          { title: "링크 있는 항목", description: "설명1", link: { web: "https://example.com/a" } },
          { title: "링크 없는 항목" },
        ],
        buttons: [{ action: "message", label: "더보기", message_text: null }],
      },
    })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "목록 제목" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "링크 있는 항목" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("설명1")).toBeInTheDocument();
    expect(screen.getByText("링크 없는 항목").tagName).toBe("SPAN"); // no link.web: shown as plain text
    expect(screen.getByRole("button", { name: "더보기" })).toBeInTheDocument();
  });

  it("does not link a list_card item whose link.web is not http(s)", () => {
    render(<RichMessage message={message({
      type: "list_card",
      list_card: { header: { title: "목록" }, items: [{ title: "항목", link: { web: "ftp://example.com/a" } }] },
    })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("항목")).toBeInTheDocument();
  });

  it("renders a carousel as a labelled, scrollable group of basic cards", () => {
    render(<RichMessage message={message({
      type: "carousel",
      carousel: { type: "basic_card", items: [{ title: "카드1" }, { title: "카드2" }, { title: "카드3" }] },
    })} interactive disabled={false} onAction={vi.fn()} />);
    const group = screen.getByRole("group", { name: "카드 3장" });
    expect(within(group).getByRole("heading", { name: "카드1" })).toBeInTheDocument();
    expect(within(group).getByRole("heading", { name: "카드3" })).toBeInTheDocument();
  });

  it("sends message_text (or the label) for a message button, and the block id for a block button", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<RichMessage message={message({
      type: "basic_card",
      basic_card: {
        title: "카드", buttons: [
          { action: "message", label: "문의", message_text: null },
          { action: "block", label: "예약하기", message_text: "예약할게요", block_id: "booking" },
        ],
      },
    })} interactive disabled={false} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "문의" }));
    expect(onAction).toHaveBeenCalledWith("문의", undefined);
    await user.click(screen.getByRole("button", { name: "예약하기" }));
    expect(onAction).toHaveBeenCalledWith("예약할게요", "booking");
  });

  it("renders a web_link button as a safe new-tab link and a phone button as a tel: link, and hides buttons when not interactive", () => {
    const { unmount } = render(<RichMessage message={message({
      type: "basic_card",
      basic_card: {
        title: "카드", buttons: [
          { action: "web_link", label: "홈페이지", web_link_url: "https://example.com" },
          { action: "phone", label: "전화하기", phone_number: "029999999" },
        ],
      },
    })} interactive disabled={false} onAction={vi.fn()} />);
    const webLink = screen.getByRole("link", { name: "홈페이지" });
    expect(webLink).toHaveAttribute("target", "_blank");
    expect(webLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "전화하기" })).toHaveAttribute("href", "tel:029999999");
    unmount();
    render(<RichMessage message={message({ type: "basic_card", basic_card: { title: "카드", buttons: [{ action: "message", label: "문의" }] } })}
                        interactive={false} disabled={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "문의" })).not.toBeInTheDocument();
  });

  it("disables message/block buttons while a send is in flight or there is no build", () => {
    render(<RichMessage message={message({ type: "basic_card", basic_card: { title: "카드", buttons: [{ action: "message", label: "문의" }] } })}
                        interactive disabled onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "문의" })).toBeDisabled();
  });
});

describe("QuickReplies", () => {
  it("renders quick_reply_items when the engine sent any, sending the block id for a block item", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickReplies message={message({
      quick_reply_items: [
        { label: "부산", action: "message", message_text: "부산", block_id: null },
        { label: "메뉴로", action: "block", message_text: null, block_id: "main_menu" },
      ],
    })} interactive disabled={false} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "부산" }));
    expect(onAction).toHaveBeenCalledWith("부산", undefined);
    await user.click(screen.getByRole("button", { name: "메뉴로" }));
    expect(onAction).toHaveBeenCalledWith("메뉴로", "main_menu");
  });

  it("falls back to quick_replies as message replies when quick_reply_items is empty or absent", () => {
    const { unmount } = render(<QuickReplies message={message({ quick_replies: ["부산"], quick_reply_items: [] })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "부산" })).toBeInTheDocument();
    unmount();
    render(<QuickReplies message={message({ quick_replies: ["서울"] })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "서울" })).toBeInTheDocument();
  });

  it("renders nothing when there are no quick replies, or when not interactive", () => {
    const { unmount } = render(<QuickReplies message={message({ quick_replies: [] })} interactive disabled={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    render(<QuickReplies message={message({ quick_replies: ["부산"] })} interactive={false} disabled={false} onAction={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
