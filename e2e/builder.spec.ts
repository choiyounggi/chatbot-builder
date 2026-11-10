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
