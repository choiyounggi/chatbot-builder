import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, daysBetween, formatPercent, kstToday, MAX_DAYS, presetRange, rangeProblem } from "./analytics";

afterEach(() => vi.useRealTimers());

describe("kstToday", () => {
  it("한국 시간 자정을 넘기면 다음 날짜가 돼요(UTC로는 아직 전날)", () => {
    expect(kstToday(new Date("2026-11-11T15:30:00Z"))).toBe("2026-11-12");
  });

  it("한국 시간 자정 전이면 UTC와 같은 날짜예요", () => {
    expect(kstToday(new Date("2026-11-11T14:00:00Z"))).toBe("2026-11-11");
  });

  it("인자가 없으면 시스템 시계를 한국 시간으로 봐요", () => {
    vi.setSystemTime(new Date("2026-11-11T15:30:00Z"));
    expect(kstToday()).toBe("2026-11-12");
  });
});

describe("addDays", () => {
  it("날짜를 앞뒤로 옮겨요", () => {
    expect(addDays("2026-11-12", 1)).toBe("2026-11-13");
    expect(addDays("2026-11-12", -6)).toBe("2026-11-06");
  });

  it("월과 해를 넘겨요", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("daysBetween", () => {
  it("양끝을 포함해서 세요", () => {
    expect(daysBetween("2026-11-06", "2026-11-12")).toBe(7);
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(1);
  });

  it("92일/93일 경계: 윤년이 아닌 2026년 1월 1일부터 4월 2일까지가 정확히 92일이에요", () => {
    expect(daysBetween("2026-01-01", "2026-04-02")).toBe(MAX_DAYS);
    expect(daysBetween("2026-01-01", "2026-04-03")).toBe(MAX_DAYS + 1);
  });
});

describe("presetRange", () => {
  it("오늘로 끝나는 7일/30일 기간을 만들어요", () => {
    const now = new Date("2026-11-12T03:00:00+09:00");
    expect(presetRange(7, now)).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(presetRange(30, now)).toEqual({ from: "2026-10-14", to: "2026-11-12" });
  });
});

describe("rangeProblem", () => {
  it("유효한 기간이면 null이에요", () => {
    expect(rangeProblem("2026-11-01", "2026-11-07")).toBeNull();
  });

  it("시작일과 종료일이 비어 있으면 알려줘요", () => {
    expect(rangeProblem("", "")).toBe("시작일과 종료일을 모두 입력해 주세요.");
    expect(rangeProblem("2026-11-01", "")).toBe("시작일과 종료일을 모두 입력해 주세요.");
  });

  it("시작일이 종료일보다 늦으면 알려줘요", () => {
    expect(rangeProblem("2026-11-10", "2026-11-01")).toBe("시작일은 종료일보다 늦을 수 없어요.");
  });

  it("92일을 넘으면 알려주고, 92일은 통과해요", () => {
    expect(rangeProblem("2026-01-01", "2026-04-02")).toBeNull();
    expect(rangeProblem("2026-01-01", "2026-04-03")).toBe(`기간은 최대 ${MAX_DAYS}일까지예요.`);
  });
});

describe("formatPercent", () => {
  it("null이면 —, 아니면 반올림한 퍼센트예요", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.333)).toBe("33%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("리뷰 후 고친 것", () => {
  it("엔진이 받는 2000~2100년 밖의 날짜는 보내기 전에 막아요(경계는 통과)", () => {
    expect(rangeProblem("1999-12-31", "2000-01-05")).toMatch(/2000년 1월 1일부터/);
    expect(rangeProblem("2000-01-01", "2000-01-05")).toBeNull();
    expect(rangeProblem("2100-12-01", "2100-12-31")).toBeNull();
    expect(rangeProblem("2100-12-31", "2101-01-01")).toMatch(/2100년 12월 31일/);
    expect(rangeProblem("0002-11-05", "0002-11-06")).toMatch(/2000년/); // a date input mid-typing
  });

  it("0이 아닌 아주 작은 비율을 0%로, 전부가 아닌 비율을 100%로 보이지 않아요", () => {
    expect(formatPercent(1 / 300)).toBe("1% 미만");
    expect(formatPercent(199 / 200)).toBe("99% 초과");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.005)).toBe("1%");
  });
});
