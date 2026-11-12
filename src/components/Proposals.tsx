import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { augment, PROPOSAL_STATUS, PROPOSAL_TYPE, type AugmentKind, type Proposal } from "../api/augment";
import { ApiError } from "../api/client";
import "../styles/augment.css";
import { ErrorNotice } from "./ErrorNotice";

const COUNTS = [10, 20, 40] as const;

function failure(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409) return "엔진에 LLM이 연결되어 있지 않아요(--llm-url로 시작해야 해요).";
  if (error.status === 404) return "저장된 내용에 아직 없어요. 먼저 저장해 주세요.";
  if (error.status === 424) return `LLM이 답하지 않았어요: ${error.message}`; // not 502: that is the dev proxy's
  return null;
}

/** "LLM으로 더 만들기": the engine's LLM proposes sentences, the engine marks the ones not to add
 * (already there, unusable, closer to another block/FAQ), and the person adds the checked ones. */
export function Proposals({ botId, kind, target, what, blocked, onAdd }: {
  botId: string; kind: AugmentKind; target: string; what: string; blocked: string | null; onAdd: (texts: string[]) => void;
}) {
  const ids = { count: useId(), list: useId() };
  const [count, setCount] = useState<number>(20);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const run = useMutation({
    mutationFn: () => augment(botId, kind, target, count),
    onSuccess: (out) => setChecked(new Set(out.items.flatMap((p, i) => (p.status === "ok" ? [i] : [])))),
  });
  const items: Proposal[] = run.data?.items ?? [];
  const add = () => {
    onAdd(items.filter((_, i) => checked.has(i)).map((p) => p.text));
    run.reset();
  };
  const toggle = (i: number) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const known = failure(run.error);

  return (
    <div className="proposals">
      <div className="proposals__bar">
        <label htmlFor={ids.count}>개수</label>
        <select id={ids.count} className="input" value={count} disabled={run.isPending} onChange={(e) => setCount(Number(e.target.value))}>
          {COUNTS.map((n) => <option key={n} value={n}>{n}개</option>)}
        </select>
        <button type="button" className="btn" disabled={blocked !== null || run.isPending} aria-busy={run.isPending}
                onClick={() => run.mutate()}>
          {run.isPending ? "LLM이 만드는 중…" : `LLM으로 ${what} 더 만들기`}
        </button>
      </div>
      {blocked && <p className="help">{blocked}</p>}
      {run.isError && (known ? <p className="notice" data-tone="error" role="alert">{known}</p>
        : <ErrorNotice error={run.error} onRetry={() => run.mutate()} />)}
      {run.isSuccess && (
        <div className="proposals__result">
          <p className="status" role="status">
            {`${run.data.model} · ${(run.data.ms / 1000).toFixed(1)}초 · ${items.length}개 중 ${items.filter((p) => p.status === "ok").length}개를 추천해요`}
          </p>
          {items.length === 0 ? <p className="help">만든 문장이 없어요. 다시 해 보세요.</p> : (
            <ul id={ids.list} className="proposals__list" aria-label={`LLM이 만든 ${what}`}>
              {items.map((p, i) => {
                const usable = p.status === "ok" || p.status === "conflict";
                return (
                  <li key={i} data-status={p.status}>
                    <label className="check">
                      <input type="checkbox" checked={checked.has(i)} disabled={!usable} onChange={() => toggle(i)} />
                      <span className="proposals__text">{p.text}</span>
                    </label>
                    <span className="chip">{PROPOSAL_TYPE[p.type]}</span>
                    {p.status !== "ok" && <span className="help" data-tone={p.status === "conflict" ? "warn" : undefined}>{`${PROPOSAL_STATUS[p.status]}: ${p.detail}`}</span>}
                    {p.status === "ok" && p.detail && <span className="help">{p.detail}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn--primary" disabled={checked.size === 0} onClick={add}>
              {`선택한 ${checked.size}개 추가`}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => run.reset()}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
