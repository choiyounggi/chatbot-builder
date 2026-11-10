import { expect, test } from "@playwright/test";

test("a new one-example block answers in the test chat after saving, before any deploy", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "샘플 봇" }).click();
  await page.getByRole("navigation", { name: "봇 메뉴" }).getByRole("link", { name: "시나리오" }).click();

  await page.getByRole("button", { name: "새 블록" }).click();
  await page.locator("#nb-label").fill("쿠폰 안내");
  await page.getByLabel("사용자 발화").fill("쿠폰 어디서 받아요");
  await page.getByLabel("봇 응답").fill("쿠폰함에서 받을 수 있어요");
  await page.getByRole("button", { name: "블록 만들기" }).click();
  await expect(page.getByRole("region", { name: "블록 쿠폰 안내" })).toBeVisible();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요" })).toBeVisible();

  await page.getByRole("button", { name: "봇테스트" }).click();
  const panel = page.getByRole("complementary", { name: "봇테스트" });
  await expect(panel.getByText(/테스트 빌드 .* 준비됨/)).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel("테스트할 발화").fill("쿠폰 어디서 받아요");
  await panel.getByRole("button", { name: "보내기" }).click();
  await expect(panel.getByRole("list", { name: "테스트 대화" }).getByText("쿠폰함에서 받을 수 있어요")).toBeVisible();

  // users are still served by the deployed version, which has no coupon block
  const live = await request.post("http://127.0.0.1:8765/v1/bots/sample/sessions/e2e-user/messages",
    { data: { text: "쿠폰 어디서 받아요" } });
  expect(live.ok()).toBe(true);
  const body = (await live.json()) as { messages: { text: string }[] };
  expect(body.messages.map((m) => m.text)).not.toContain("쿠폰함에서 받을 수 있어요");
});

test("a card reply shows in the test chat, and its block buttons start the block without understanding", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept()); // switching the reply's kind asks before dropping its text
  await page.goto("/");
  await page.getByRole("link", { name: "샘플 봇" }).click();
  await page.getByRole("navigation", { name: "봇 메뉴" }).getByRole("link", { name: "시나리오" }).click();
  await page.getByRole("link", { name: /도움말/ }).click();
  const editor = page.getByRole("region", { name: "블록 도움말" });

  await editor.getByLabel("응답 1 형식").selectOption("basic_card");
  await editor.getByLabel("응답 1 제목").fill("무엇을 도와드릴까요");
  await editor.getByLabel("응답 1 설명").fill("아래에서 골라 보세요");
  await editor.getByRole("button", { name: "버튼 추가" }).click();
  await editor.getByLabel("응답 1 버튼 1 이름").fill("지금 시각");
  await editor.getByLabel("응답 1 버튼 1 동작").selectOption("block");
  await editor.getByLabel("응답 1 버튼 1 이동할 블록").selectOption("current_time");
  await editor.getByRole("button", { name: "바로연결 추가" }).click();
  await editor.getByLabel("응답 1 바로연결 1 이름").fill("날씨 묻기");
  await editor.getByLabel("응답 1 바로연결 1 동작").selectOption("block");
  await editor.getByLabel("응답 1 바로연결 1 이동할 블록").selectOption("check_weather");

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요" })).toBeVisible();
  await page.getByRole("button", { name: "봇테스트" }).click();
  const panel = page.getByRole("complementary", { name: "봇테스트" });
  await expect(panel.getByText(/테스트 빌드 .* 준비됨/)).toBeVisible({ timeout: 30_000 });
  const chat = panel.getByRole("list", { name: "테스트 대화" });

  await panel.getByLabel("테스트할 발화").fill("도움말");
  await panel.getByRole("button", { name: "보내기" }).click();
  await expect(chat.getByText("무엇을 도와드릴까요")).toBeVisible();
  await expect(chat.getByText("아래에서 골라 보세요")).toBeVisible();

  // the block quick reply starts the weather block directly: it asks for the location, and the
  // engine reports rule "block" (no understanding involved)
  await chat.getByRole("button", { name: "날씨 묻기" }).click();
  await expect(chat.getByText("어느 지역이요?")).toBeVisible();
  await chat.getByText("엔진이 판단한 것").last().click();
  await expect(chat.locator("dd", { hasText: /^block$/ }).last()).toBeVisible();

  await chat.getByRole("button", { name: "지금 시각" }).click(); // the card's block button
  await expect(chat.getByText(/^지금은 .+예요\.$/)).toBeVisible();
});
