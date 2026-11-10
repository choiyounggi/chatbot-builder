import { SECTIONS } from "./BotLayout";

/** The builder step that builds each section (docs/builder-plan.md §6). */
const STEP: Record<string, string> = {
  skills: "B5 — 스킬 화면",
  training: "B4 — 학습대기·학습이력",
  analytics: "B7 — 분석",
  deploy: "B4 — 배포·히스토리·되돌리기",
  history: "B4 — 작업이력",
  ml: "B4 — 머신러닝 설정",
};

export function NotYet({ section }: { section: string }) {
  const label = SECTIONS.find((s) => s.path === section)?.label ?? section;
  return (
    <>
      <header>
        <h1>{label}</h1>
        <p>아직 만들지 않은 화면이에요. 계획상 <strong>{STEP[section] ?? "다음 단계"}</strong>에서 만들어요.</p>
      </header>
    </>
  );
}
