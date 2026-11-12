import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { augment, PROPOSAL_STATUS, PROPOSAL_TYPE, type AugmentKind, type Proposal } from "../api/augment";
import { ApiError } from "../api/client";
import "../styles/augment.css";
import { ErrorNotice } from "./ErrorNotice";

const COUNTS = [10, 20, 40] as const;
const LLM_FAILED = "the LLM did not answer: ";

function failure(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 && /no LLM/.test(error.message)) return "엔진에 LLM이 연결되어 있지 않아요(--llm-url로 시작해야 해요).";
  if (error.status === 404 && /saved/.test(error.message)) return "저장된 내용에 아직 없어요. 먼저 저장해 주세요.";
  if (error.status === 424) return `LLM이 답하지 않았어요 (${error.message.replace(LLM_FAILED, "")}). 다시 해 보세요.`; // not 502: the dev proxy's
  return null;
}

/** "LLM으로 더 만들기": the engine's LLM proposes sentences, the engine marks the ones not to add
 * (already there, unusable, closer to another block/FAQ), and the person adds the checked ones.
 * `scope` names whose sentences these are when a page has several (e.g. "FAQ 2"); `room`: how many
 * more fit. */
export function Proposals({ botId, kind, target, what, scope, room, blocked, onAdd }: {
  botId: string; kind: AugmentKind; target: string; what: string; scope?: string; room?: number;
  blocked: string | null; onAdd: (texts: string[]) => void;
}) {
  const ids = { count: useId(), reason: useId() };
  const prefix = scope ? `${scope} ` : "";
  const [count, setCount] = useState<number>(20);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const start = useRef<HTMLButtonElement>(null);
  const run = useMutation({
    mutationFn: () => augment(botId, kind, target, count),
    onSuccess: (out) => setChecked(new Set(out.items.flatMap((p, i) => (p.status === "ok" ? [i] : [])))),
  });
  const { reset } = run;
  // edited since it ran: the engine screened against what was saved then
  useEffect(() => { if (blocked) reset(); }, [blocked, reset]);
  const items: Proposal[] = run.data?.items ?? [];
  const over = room !== undefined && checked.size > room;
  const close = () => {
    run.reset();
    start.current?.focus();
  };
  const add = () => {
    onAdd(items.filter((_, i) => checked.has(i)).map((p) => p.text));
    close();
  };
  const toggle = (i: number) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const known = failure(run.error);
  const progress = run.isPending ? "LLM이 만드는 중이에요…"
    : run.isSuccess ? `${run.data.model} · ${(run.data.ms / 1000).toFixed(1)}초 · ${items.length}개 중 ${items.filter((p) => p.status === "ok").length}개를 추천해요`
    : "";

  return (
    <div className="proposals">
      <div className="proposals__bar">
        <label htmlFor={ids.count}>{`${prefix}개수`}</label>
        <select id={ids.count} className="input" value={count} disabled={run.isPending} onChange={(e) => setCount(Number(e.target.value))}>
          {COUNTS.map((n) => <option key={n} value={n}>{n}개</option>)}
        </select>
        <button type="button" ref={start} className="btn" disabled={blocked !== null || run.isPending} aria-busy={run.isPending}
                aria-label={`${prefix}LLM으로 ${what} 더 만들기`} aria-describedby={blocked ? ids.reason : undefined}
                onClick={() => run.mutate()}>
          {run.isPending ? "LLM이 만드는 중…" : `LLM으로 ${what} 더 만들기`}
        </button>
      </div>
      {blocked && <p id={ids.reason} className="help">{blocked}</p>}
      <p className="status" role="status">{progress}</p>
      {run.isError && (known ? <p className="notice" data-tone="error" role="alert">{known}</p>
        : <ErrorNotice error={run.error} onRetry={() => run.mutate()} />)}
      {run.isSuccess && (
        <div className="proposals__result">
          {items.length === 0 ? <p className="help">만든 문장이 없어요. 다시 해 보세요.</p> : (
            <ul className="proposals__list" aria-label={`${prefix}LLM이 만든 ${what}`}>
              {items.map((p, i) => {
                const usable = p.status === "ok" || p.status === "conflict";
                const note = p.status === "ok" ? p.detail : `${PROPOSAL_STATUS[p.status]}: ${p.detail}`;
                const noteId = `${ids.count}-p${i}`;
                return (
                  <li key={i} data-status={p.status}>
                    <label className="check">
                      <input type="checkbox" checked={checked.has(i)} disabled={!usable} onChange={() => toggle(i)}
                             aria-describedby={noteId} />
                      <span className="proposals__text">{p.text}</span>
                    </label>
                    <span id={noteId} className="proposals__note">
                      <span className="chip">{PROPOSAL_TYPE[p.type]}</span>
                      {note && <span className="help" data-tone={p.status === "conflict" ? "warn" : undefined}>{note}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {over && <p className="help" data-tone="warn">{`${room}개까지 더 넣을 수 있어요. 선택을 줄여 주세요.`}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn--primary" disabled={checked.size === 0 || over} onClick={add}>
              {`선택한 ${checked.size}개 추가`}
            </button>
            <button type="button" className="btn btn--quiet" onClick={close}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
