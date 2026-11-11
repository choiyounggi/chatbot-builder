// B5: calling skills from a block, and checking a parameter's value with a skill.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotDoc } from "../model/doc";
import sample from "../test/fixtures/sample-bot.json";
import { botEngine, renderAt } from "../test/engine";

afterEach(() => vi.unstubAllGlobals());

const saved = (state: ReturnType<typeof botEngine>["state"]) => state.puts.at(-1)?.body as unknown as BotDoc;
const withSkills = () => {
  const doc = structuredClone(sample) as unknown as BotDoc;
  doc.skills = { get_order: { label: "주문 조회", url: "https://shop.example/order" }, check_city: { url: "https://shop.example/city" } };
  return doc as unknown as Record<string, unknown>;
};
const editor = () => screen.findByRole("region", { name: /^블록 (?!목록)/ });
async function saveNow(state: ReturnType<typeof botEngine>["state"]) {
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText(/저장했어요/);
  return saved(state);
}

describe("skills in a block", () => {
  it("adds a skill with arguments before the replies, and removes it", async () => {
    const { state } = botEngine({ doc: withSkills() });
    renderAt("/bots/sample/scenarios/greet");
    const e = await editor();
    await userEvent.click(within(e).getByRole("button", { name: "스킬 추가" }));
    expect(within(e).getByLabelText("스킬 1")).toHaveValue("get_order");
    await userEvent.selectOptions(within(e).getByLabelText("스킬 1"), "check_city");
    await userEvent.click(within(e).getByRole("button", { name: "인자 추가" }));
    await userEvent.clear(within(e).getByLabelText("스킬 1 인자 1 이름"));
    await userEvent.type(within(e).getByLabelText("스킬 1 인자 1 이름"), "city");
    await userEvent.type(within(e).getByLabelText("스킬 1 인자 1 값"), "서울");
    let doc = await saveNow(state);
    expect(doc.scenarios.greet?.steps).toEqual([{ action: "check_city", args: { city: "서울" } }, { respond: "greeting" }]);
    await userEvent.click(within(e).getByRole("button", { name: "스킬 1 인자 1 삭제" }));
    await userEvent.click(within(e).getByRole("button", { name: "스킬 1 빼기" }));
    doc = await saveNow(state);
    expect(doc.scenarios.greet?.steps).toEqual([{ respond: "greeting" }]);
  });

  it("shows a built-in action a block already calls, and explains when there are no skills", async () => {
    botEngine();
    renderAt("/bots/sample/scenarios/check_weather");
    const e = await editor();
    expect(within(e).getByLabelText("스킬 1")).toHaveDisplayValue("get_weather (내장 액션)");
    expect(within(e).getByLabelText("스킬 1 인자 1 이름")).toHaveValue("location");
    expect(within(e).getByText("아직 스킬이 없어요. 스킬 메뉴에서 먼저 만들어 주세요.")).toBeInTheDocument();
    expect(within(e).queryByLabelText("location 값 검증")).toBeNull(); // nothing to check with
  });

  it("checks a parameter's value with a skill and a failure message", async () => {
    const { state } = botEngine({ doc: withSkills() });
    renderAt("/bots/sample/scenarios/check_weather");
    const e = await editor();
    await userEvent.selectOptions(within(e).getByLabelText("location 값 검증"), "check_city");
    const fail = within(e).getByLabelText("location 검증 실패 안내");
    expect(fail).toHaveValue("올바른 값이 아니에요. 다시 알려 주세요.");
    await userEvent.clear(fail);
    await userEvent.type(fail, "그런 지역은 없어요");
    let doc = await saveNow(state);
    expect(doc.scenarios.check_weather?.slots?.location?.validation).toEqual({ action: "check_city", fail: "check_weather_location_invalid" });
    expect(doc.responses.check_weather_location_invalid).toEqual({ text: "그런 지역은 없어요" });
    await userEvent.selectOptions(within(e).getByLabelText("location 값 검증"), "");
    doc = await saveNow(state);
    expect(doc.scenarios.check_weather?.slots?.location?.validation).toBeUndefined();
    expect(doc.responses.check_weather_location_invalid).toBeUndefined();
  });
});
