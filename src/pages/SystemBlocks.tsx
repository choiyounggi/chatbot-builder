// 기본 시나리오: welcome, fallback, escape and the conversation settings (docs/builder-plan.md §2.5).
import { type FormEvent, type ReactNode, useState } from "react";
import { type BlockOption, ReplyEditor } from "../components/ReplyEditor";
import { useDraft } from "../draft/DraftContext";
import { replyOf, writeResponse } from "../model/blocks";
import type { BotDoc } from "../model/doc";
import { createWelcome, readSystem, setEscape, setMaxAttempts, setTimeoutMinutes, setTimeoutNotice, setWelcome } from "../model/system";

export const SYSTEM_PAGES = [
  { id: "_welcome", label: "웰컴", meta: "대화를 열면" },
  { id: "_fallback", label: "폴백", meta: "못 알아들으면" },
  { id: "_escape", label: "탈출", meta: "진행 중인 대화 끝내기" },
  { id: "_settings", label: "시나리오 설정", meta: "되묻기·대기 시간" },
] as const;
export type SystemPage = (typeof SYSTEM_PAGES)[number]["id"];

export const isSystemPage = (id: string | undefined): id is SystemPage => SYSTEM_PAGES.some((p) => p.id === id);

export function SystemEditor({ page, blocks, renderBlock }: {
  page: SystemPage; blocks: BlockOption[]; renderBlock: (id: string) => ReactNode;
}) {
  const title = SYSTEM_PAGES.find((p) => p.id === page)?.label ?? "";
  return (
    <section className="editor" aria-label={`기본 시나리오 ${title}`}>
      <div className="editor-head"><h2>{title}</h2><span className="chip">기본 시나리오</span></div>
      {page === "_welcome" && <Welcome renderBlock={renderBlock} />}
      {page === "_fallback" && <Fallback blocks={blocks} />}
      {page === "_escape" && <Escape blocks={blocks} renderBlock={renderBlock} />}
      {page === "_settings" && <Settings />}
    </section>
  );
}

function Welcome({ renderBlock }: { renderBlock: (id: string) => ReactNode }) {
  const draft = useDraft();
  const doc = draft.doc as BotDoc;
  const { welcome } = readSystem(doc);
  const on = welcome !== null && !!doc.scenarios[welcome];
  const toggle = () => draft.update((d) => (on ? setWelcome(d, null) : createWelcome(d, "안녕하세요! 무엇을 도와드릴까요?").doc));
  return (
    <>
      <p className="status">사용자가 대화를 처음 열면 봇이 먼저 하는 말이에요. 봇테스트에서 새 대화를 시작하면 확인할 수 있어요.</p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={toggle} /> 웰컴 블록 사용
      </label>
      {on && <p className="help">끄면 블록은 지우지 않고 일반 블록 목록으로 옮겨요.</p>}
      {on && welcome && renderBlock(welcome)}
    </>
  );
}

function Fallback({ blocks }: { blocks: BlockOption[] }) {
  const draft = useDraft();
  const doc = draft.doc as BotDoc;
  const reply = replyOf(doc, "fallback");
  const examples = doc.intents?.out_of_scope?.examples;
  return (
    <>
      <p className="status">어떤 블록에도 맞지 않는 말에 하는 응답이에요. 문구를 여러 개 두면 그중 하나를 골라 말해요.</p>
      <ReplyEditor reply={reply} index={0} blocks={blocks} textOnly
                   onChange={(next) => draft.update((d) => { writeResponse(d, next); return d; })} />
      {examples && (
        <PhraseList title="모르는 질문 예시" help="봇이 답하지 않아야 할 말이에요. 학습할 때 '모르는 질문'으로 배워요. 하나는 남겨 둬야 해요."
                    inputLabel="새 모르는 질문" items={examples} minItems={1}
                    onChange={(items) => draft.update((d) => ({ ...d, intents: { ...d.intents, out_of_scope: { ...d.intents?.out_of_scope, examples: items } } }))} />
      )}
    </>
  );
}

function Escape({ blocks, renderBlock }: { blocks: BlockOption[]; renderBlock: (id: string) => ReactNode }) {
  const draft = useDraft();
  const doc = draft.doc as BotDoc;
  const { escapePhrases, escapeScenario } = readSystem(doc);
  const cancelled = replyOf(doc, "cancelled");
  return (
    <>
      <p className="status">이 말과 똑같이 입력하면(띄어쓰기·문장부호는 무시) 진행 중인 대화를 모두 끝내요. "취소", "그만" 같은 기본 문구는 따로 없어도 동작해요.</p>
      <PhraseList title="탈출 문구" inputLabel="새 탈출 문구" items={escapePhrases}
                  help="비워 두면 탈출 블록을 쓰지 않아요."
                  onChange={(items) => draft.update((d) => setEscape(d, items, readSystem(d).escapeScenario))} />
      {escapePhrases.length > 0 && (
        <div className="field">
          <label htmlFor="escape-block">끝낸 뒤 실행할 블록</label>
          <select id="escape-block" className="input" value={escapeScenario ?? ""}
                  onChange={(e) => draft.update((d) => setEscape(d, readSystem(d).escapePhrases, e.target.value || null))}>
            <option value="">없음 (아래 응답만)</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.label || b.id}</option>)}
          </select>
        </div>
      )}
      {escapePhrases.length > 0 && !escapeScenario && (
        <ReplyEditor reply={cancelled} index={0} blocks={blocks} textOnly
                     onChange={(next) => draft.update((d) => { writeResponse(d, next); return d; })} />
      )}
      {escapePhrases.length > 0 && escapeScenario && doc.scenarios[escapeScenario] && renderBlock(escapeScenario)}
    </>
  );
}

function Settings() {
  const draft = useDraft();
  const doc = draft.doc as BotDoc;
  const system = readSystem(doc);
  // what is being typed in the minutes field while it is not a valid number (null: show the draft's value)
  const [minutesText, setMinutesText] = useState<string | null>(null);
  const shown = minutesText ?? String(system.timeoutMinutes ?? 30);
  const minutesValid = /^\d+$/.test(shown) && Number(shown) >= 1 && Number(shown) <= 1440;
  const notice = doc.system?.timeout?.notice;
  return (
    <>
      <div className="field">
        <label htmlFor="max-attempts">되묻기 최대 횟수</label>
        <select id="max-attempts" className="input" value={system.maxAttempts}
                onChange={(e) => draft.update((d) => setMaxAttempts(d, Number(e.target.value)))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}번</option>)}
        </select>
        <p className="help">파라미터를 이만큼 되물어도 답을 못 받으면 그 대화를 그만두고 폴백 응답을 해요.</p>
      </div>
      <label className="check">
        <input type="checkbox" checked={system.timeoutMinutes !== null}
               onChange={(e) => {
                 setMinutesText(null);
                 draft.update((d) => setTimeoutMinutes(d, e.target.checked ? 30 : null));
               }} /> 대기 시간이 지나면 처음부터
      </label>
      {system.timeoutMinutes !== null && (
        <>
          <div className="field">
            <label htmlFor="timeout-minutes">대기 시간(분)</label>
            <input id="timeout-minutes" className="input" type="number" min={1} max={1440} step={1} value={shown}
                   aria-invalid={!minutesValid} aria-describedby="timeout-minutes-help"
                   onChange={(e) => {
                     const minutes = Number(e.target.value);
                     if (/^\d+$/.test(e.target.value) && minutes >= 1 && minutes <= 1440) {
                       setMinutesText(null);
                       draft.update((d) => setTimeoutMinutes(d, minutes));
                     } else setMinutesText(e.target.value);
                   }} />
            <p id="timeout-minutes-help" className="help" data-tone={minutesValid ? undefined : "warn"}>
              {minutesValid ? "마지막 말 뒤로 이만큼 지나면 다음 말에서 대화를 처음부터 시작해요(1~1440분)."
                : `1~1440 사이의 정수를 넣어 주세요. 지금은 ${system.timeoutMinutes}분으로 저장돼요.`}
            </p>
          </div>
          <div className="field">
            <label htmlFor="timeout-notice">시간 초과 안내</label>
            <input id="timeout-notice" className="input" value={system.timeoutNoticeEditable ? system.timeoutNotice : ""}
                   placeholder={doc.responses.restarted?.text ?? ""}
                   onChange={(e) => draft.update((d) => setTimeoutNotice(d, e.target.value))} />
            <p className="help">
              {system.timeoutNoticeEditable
                ? `진행 중이던 대화가 있었을 때만 말해요. 비우면 "처음부터 다시" 응답을 써요. {{ }} 변수는 쓸 수 없어요.`
                : `지금은 응답 ${notice}을(를) 써요. 다른 곳에서도 쓰거나 글 하나가 아니라서 여기서는 고치지 않아요. 여기에 쓰면 이 안내만의 응답을 새로 만들어요.`}
            </p>
          </div>
        </>
      )}
    </>
  );
}

function PhraseList({ title, help, inputLabel, items, onChange, minItems = 0 }: {
  title: string; help: string; inputLabel: string; items: string[]; onChange: (items: string[]) => void; minItems?: number;
}) {
  const [text, setText] = useState("");
  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (!items.includes(value)) onChange([...items, value]);
    setText("");
  };
  return (
    <fieldset className="group">
      <legend>{title} <span className="status">({items.length}개)</span></legend>
      <p className="status">{help}</p>
      <form className="inline-add" onSubmit={add}>
        <label className="visually-hidden" htmlFor={`add-${inputLabel.replace(/\s+/g, "-")}`}>{inputLabel}</label>
        <input id={`add-${inputLabel.replace(/\s+/g, "-")}`} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="입력하고 Enter" />
        <button type="submit" className="btn" disabled={!text.trim()}>추가</button>
      </form>
      <ul className="examples">
        {items.map((item, i) => (
          <li key={i}>
            <span>{item}</span>
            {items.length > minItems && (
              <button type="button" className="btn btn--quiet" aria-label={`"${item}" 삭제`}
                      onClick={() => onChange(items.filter((_, j) => j !== i))}>삭제</button>
            )}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

