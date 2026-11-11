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
  await expect(chat.getByText(/^지금은 .+에요\.$/)).toBeVisible(); // "…시예요." or "…분이에요."
});

test("a misunderstood sentence added to a block, trained and deployed, goes to that block", async ({ page, request }) => {
  const sentence = "양자컴퓨터로 내일 날씨 예측해 줄래";
  const say = async (session: string) => {
    const r = await request.post(`http://127.0.0.1:8765/v1/bots/sample/sessions/${session}/messages`, { data: { text: sentence } });
    expect(r.ok()).toBe(true);
    return ((await r.json()) as { messages: { response: string }[] }).messages.map((m) => m.response);
  };
  expect(await say("e2e-queue-1")).toEqual(["fallback"]);

  // earlier tests leave a one-example block; deploy training needs 5 examples per block
  const draftUrl = "http://127.0.0.1:8765/v1/builder/bots/sample/draft";
  const current = await request.get(draftUrl);
  const doc = (await current.json()) as { intents: Record<string, { examples: string[] }> };
  for (const [id, intent] of Object.entries(doc.intents)) {
    for (let n = 1; intent.examples.length < 5; n++) intent.examples.push(`${id} 예문 ${n}번째로 추가한 문장`);
  }
  const saved = await request.put(draftUrl, { data: doc, headers: { "If-Match": current.headers().etag ?? "" } });
  expect(saved.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("link", { name: "샘플 봇" }).click();
  await page.getByRole("navigation", { name: "봇 메뉴" }).getByRole("link", { name: "학습" }).click();
  const row = page.getByRole("listitem").filter({ hasText: sentence });
  await expect(row).toBeVisible();
  await row.getByLabel(/을 넣을 블록/).selectOption("weather");
  await row.getByRole("button", { name: "예문으로 추가" }).click();
  await expect(page.getByText(/‘날씨 안내’의 예문으로 넣었어요/)).toBeVisible();
  await expect(row).toHaveCount(0); // handled: out of the pending queue

  await page.getByRole("navigation", { name: "봇 메뉴" }).getByRole("link", { name: "배포" }).click();
  await page.getByRole("button", { name: "배포용 학습" }).click();
  await expect(page.getByText(/학습을 마쳤어요 · macro-F1/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "배포", exact: true }).click();
  await expect(page.getByText(/v\d+ 배포됨/)).toBeVisible();

  expect(await say("e2e-queue-2")).toEqual(["ask_location"]); // the weather block starts and asks where
});

test("a skill made in the builder is tested, connected to a block, and answers in the chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "샘플 봇" }).click();
  const menu = page.getByRole("navigation", { name: "봇 메뉴" });
  await menu.getByRole("link", { name: "스킬" }).click();

  await page.getByRole("button", { name: "새 스킬" }).click();
  await page.getByLabel("이름", { exact: true }).fill("주문 조회");
  await page.getByLabel("URL", { exact: true }).fill("http://127.0.0.1:8799/order"); // e2e/skill-server.mjs
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요" })).toBeVisible();

  await page.getByRole("button", { name: "파라미터 추가" }).click();
  await page.getByLabel("파라미터 1 이름").fill("no");
  await page.getByLabel("파라미터 1 값").fill("7");
  await page.getByRole("button", { name: "테스트 실행" }).click();
  await expect(page.getByText(/^성공 · 200 · \d+ms$/)).toBeVisible();
  await expect(page.locator("pre")).toContainText('"order": "A-7"');

  await menu.getByRole("link", { name: "시나리오" }).click();
  await page.getByRole("link", { name: /칭찬 답례/ }).click();
  const editor = page.getByRole("region", { name: "블록 칭찬 답례" });
  await editor.getByRole("button", { name: "스킬 추가" }).click();
  await expect(editor.getByLabel("스킬 1", { exact: true })).toHaveValue("skill_1");
  await editor.getByRole("button", { name: "인자 추가" }).click();
  await editor.getByLabel("스킬 1 인자 1 이름").fill("no");
  await editor.getByLabel("스킬 1 인자 1 값").fill("3");
  await editor.getByLabel("응답 1 문구 1").fill("주문 {{ results.skill_1.order }}은 {{ results.skill_1.status }}이에요.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요" })).toBeVisible();

  await page.getByRole("button", { name: "봇테스트" }).click();
  const panel = page.getByRole("complementary", { name: "봇테스트" });
  await expect(panel.getByText(/테스트 빌드 .* 준비됨/)).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel("테스트할 발화").fill("너 정말 똑똑하네");
  await panel.getByRole("button", { name: "보내기" }).click();
  await expect(panel.getByRole("list", { name: "테스트 대화" }).getByText("주문 A-3은 배송 중이에요.")).toBeVisible();
});

test("a document uploaded in the builder, indexed and deployed with the bot, answers a question no block has", async ({ page, request }) => {
  const engineUrl = "http://127.0.0.1:8765";
  const question = "우산은 어디서 빌릴 수 있나요";
  const ask = async (session: string) => {
    const r = await request.post(`${engineUrl}/v1/bots/sample/sessions/${session}/messages`, { data: { text: question } });
    expect(r.ok()).toBe(true);
    return ((await r.json()) as { messages: { response: string; text: string }[] }).messages;
  };
  expect((await ask("e2e-kb-1")).map((m) => m.response)).toEqual(["fallback"]); // no block has it

  // deploy training needs 5 examples per block (earlier tests may leave a one-example block)
  const draftUrl = `${engineUrl}/v1/builder/bots/sample/draft`;
  const current = await request.get(draftUrl);
  const doc = (await current.json()) as { intents: Record<string, { examples: string[] }> };
  for (const [id, intent] of Object.entries(doc.intents)) {
    for (let n = 1; intent.examples.length < 5; n++) intent.examples.push(`${id} 예문 ${n}번째로 추가한 문장`);
  }
  expect((await request.put(draftUrl, { data: doc, headers: { "If-Match": current.headers().etag ?? "" } })).ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("link", { name: "샘플 봇" }).click();
  const menu = page.getByRole("navigation", { name: "봇 메뉴" });
  await menu.getByRole("link", { name: "지식베이스" }).click();
  await page.getByRole("button", { name: "문서", exact: true }).click();
  await page.locator("#kb-file-input").setInputFiles({
    name: "center.md", mimeType: "text/markdown",
    buffer: Buffer.from("# 센터 이용 안내\n\n## 우산 대여\n\n우산은 정문 안내 데스크에서 하루 동안 무료로 빌릴 수 있습니다. "
      + "돌려줄 때는 같은 데스크에 맡기면 됩니다.\n\n## 주차\n\n주차장은 지하 2층에 있고 두 시간까지 무료입니다.\n"),
  });
  await expect(page.locator("#doc-text")).toHaveValue(/정문 안내 데스크/);
  await page.getByRole("button", { name: "지식베이스 저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "지식베이스를 저장했어요" })).toBeVisible();

  await page.getByRole("button", { name: "버전", exact: true }).click();
  await page.getByRole("button", { name: "색인 만들기" }).click();
  await expect(page.getByText(/^v\d+ 색인 완료 · FAQ 0개 · 조각 2개$/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "검색 테스트" }).click();
  await page.locator("#kb-search-query").fill(question);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText(/정문 안내 데스크에서 하루 동안/).first()).toBeVisible();

  await menu.getByRole("link", { name: "배포" }).click();
  await page.getByRole("button", { name: "배포용 학습" }).click();
  await expect(page.getByText(/학습을 마쳤어요 · macro-F1/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#deploy-kb")).not.toHaveValue(""); // the newest index by default
  await page.getByRole("button", { name: "배포", exact: true }).click();
  await expect(page.getByText(/^v\d+ 배포됨 · 지식베이스 v\d+$/)).toBeVisible();

  const [answer] = await ask("e2e-kb-2");
  expect(answer?.response).toBe("knowledge");
  expect(answer?.text).toContain("우산은 정문 안내 데스크에서 하루 동안 무료로 빌릴 수 있습니다.");
  expect(answer?.text).toContain("출처: center.md");
});
