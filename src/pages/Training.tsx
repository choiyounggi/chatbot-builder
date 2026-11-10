// 학습: what users said, grouped by sentence (학습대기), and what was done with it (학습이력).
// Adding a sentence to a block edits the stored draft right away (like a save), so it needs the
// draft without unsaved changes; it reaches users after 배포용 학습 and 배포.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, ConflictError } from "../api/client";
import { addUtterances, ignoreUtterances, listMarks, listUtterances, type QueueFilter, restoreUtterances, type Utterance } from "../api/training";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import { listBlocks } from "../model/blocks";
import type { BotDoc } from "../model/doc";

const OOS = "out_of_scope";
const PERIODS = [
  { id: "1", label: "오늘", days: 0 },
  { id: "7", label: "최근 7일", days: 7 },
  { id: "30", label: "최근 30일", days: 30 },
  { id: "all", label: "전체 기간", days: null },
] as const;
const RULE_LABEL: Record<string, string> = {
  fallback: "못 알아들음", clarify: "되물음", intent: "블록 시작", slot: "파라미터 답", rerun: "다시 실행", system: "취소·처음으로",
};

/** Start of the period in this browser's time zone, as an ISO time the engine accepts. */
export function periodStart(days: number | null, now = new Date()): string | null {
  if (days === null) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

/** Blocks a sentence can be added to: trigger blocks (by their intent) and 모르는 질문. */
function targetsOf(doc: BotDoc): { intent: string; label: string }[] {
  const blocks = listBlocks(doc).filter((b) => b.intent).map((b) => ({ intent: b.intent as string, label: b.label || b.id }));
  return doc.intents?.[OOS] ? [...blocks, { intent: OOS, label: "모르는 질문(폴백)" }] : blocks;
}

export function Training() {
  const [tab, setTab] = useState<"queue" | "marks">("queue");
  return (
    <>
      <header>
        <h1>학습</h1>
        <p>사용자가 한 말을 문장별로 모아 봐요. 못 알아들은 말을 블록의 예문으로 넣고, 배포용 학습과 배포를 하면 다음부터 그 블록으로 가요.</p>
      </header>
      <div className="tabs" role="group" aria-label="학습 화면">
        <button type="button" className="btn" aria-pressed={tab === "queue"} onClick={() => setTab("queue")}>학습대기</button>
        <button type="button" className="btn" aria-pressed={tab === "marks"} onClick={() => setTab("marks")}>학습이력</button>
      </div>
      {tab === "queue" ? <Queue /> : <Marks />}
    </>
  );
}

function Queue() {
  const draft = useDraft();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("7");
  const [rule, setRule] = useState<QueueFilter["rule"]>("misunderstood");
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState<QueueFilter["status"]>("pending");
  const since = useMemo(() => periodStart(PERIODS.find((p) => p.id === period)?.days ?? null), [period]);
  const filter: QueueFilter = { since, rule, intent: intent || null, status };
  const queue = useQuery({ queryKey: ["utterances", draft.botId, filter], queryFn: () => listUtterances(draft.botId, filter) });
  const targets = draft.doc ? targetsOf(draft.doc) : [];
  // outside the rows: a row leaves the list once handled, its result must stay visible
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <section aria-label="학습대기">
      <p className="help" role="status" data-tone={notice?.tone}>{notice?.text ?? ""}</p>
      <div className="filters">
        <Select id="q-period" label="기간" value={period} onChange={(v) => setPeriod(v as typeof period)}
                options={PERIODS.map((p) => [p.id, p.label])} />
        <Select id="q-rule" label="보기" value={rule} onChange={(v) => setRule(v as QueueFilter["rule"])}
                options={[["misunderstood", "못 알아들은 말"], ["all", "모든 말"]]} />
        <Select id="q-intent" label="블록" value={intent} onChange={setIntent}
                options={[["", "전체"], ...targets.map((t): [string, string] => [t.intent, t.label])]} />
        <Select id="q-status" label="상태" value={status} onChange={(v) => setStatus(v as QueueFilter["status"])}
                options={[["pending", "대기"], ["ignored", "무시함"], ["added", "추가함"], ["all", "전체"]]} />
      </div>
      {draft.dirty && <p className="notice" data-tone="warn">저장 안 된 변경이 있어요. 예문으로 추가하려면 먼저 저장하거나 변경을 취소해 주세요.</p>}
      {queue.isError ? <ErrorNotice error={queue.error} onRetry={() => void queue.refetch()} />
        : !queue.data ? <p className="status" role="status">불러오는 중…</p>
          : (
            <>
              {queue.data.truncated && <p className="help" data-tone="warn">기간 안의 말이 너무 많아 최근 {queue.data.scanned.toLocaleString()}개만 봤어요. 기간을 줄여 보세요.</p>}
              {queue.data.items.length === 0
                ? <p className="status">이 조건에 맞는 말이 없어요.</p>
                : <ul className="queue">{queue.data.items.map((item, i) => <QueueRow key={item.key} index={i} item={item} targets={targets} onNotice={setNotice} />)}</ul>}
            </>
          )}
    </section>
  );
}

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

function QueueRow({ item, index, targets, onNotice }: {
  item: Utterance; index: number; targets: { intent: string; label: string }[]; onNotice: (n: Notice) => void;
}) {
  const draft = useDraft();
  const queryClient = useQueryClient();
  const predicted = targets.some((t) => t.intent === item.intent) ? item.intent ?? "" : "";
  // null: not chosen yet, so follow the closest block (the draft may load after the queue)
  const [chosen, setChosen] = useState<string | null>(null);
  const target = chosen ?? predicted;
  const labelOf = (intent: string | null | undefined) => targets.find((t) => t.intent === intent)?.label ?? intent ?? "—";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["utterances", draft.botId] });
    void queryClient.invalidateQueries({ queryKey: ["marks", draft.botId] });
  };
  const add = useMutation({
    mutationFn: async () => {
      const etag = draft.query.data?.etag;
      if (!etag) throw new Error("the draft is not loaded");
      return addUtterances(draft.botId, [item.text], target, etag);
    },
    onSuccess: () => {
      onNotice({ tone: "ok", text: `‘${item.text}’을 ‘${labelOf(target)}’의 예문으로 넣었어요. 배포용 학습과 배포를 하면 사용자에게 반영돼요.` });
      void queryClient.invalidateQueries({ queryKey: ["draft", draft.botId] });
      refresh();
    },
    onError: (error) => {
      if (error instanceof ConflictError) {
        onNotice({ tone: "warn", text: "초안이 다른 곳에서 바뀌었어요. 다시 불러왔으니 한 번 더 눌러 주세요." });
        draft.reload();
      } else {
        onNotice({ tone: "warn", text: error instanceof ApiError && error.status === 409 ? `‘${item.text}’은 이미 다른 블록의 예문이에요.`
          : error instanceof ApiError && error.status === 422 ? "이 문장은 예문으로 넣을 수 없어요(비어 있거나 {중괄호}가 있어요)."
            : "넣지 못했어요. 잠시 후 다시 시도해 주세요." });
      }
    },
  });
  const mark = useMutation({
    mutationFn: (status: "ignored" | "pending") => (status === "ignored" ? ignoreUtterances : restoreUtterances)(draft.botId, [item.text]),
    onSuccess: (_, status) => {
      onNotice({ tone: "ok", text: status === "ignored" ? `‘${item.text}’을 무시했어요.` : `‘${item.text}’을 대기로 되돌렸어요.` });
      refresh();
    },
    onError: () => onNotice({ tone: "warn", text: "처리하지 못했어요. 잠시 후 다시 시도해 주세요." }),
  });
  const busy = add.isPending || mark.isPending;
  const id = `q-target-${index}`;
  return (
    <li className="queue-item">
      <p className="queue-text">{item.text}</p>
      <p className="queue-meta">
        {item.count}회 · 세션 {item.sessions} · 마지막 {when(item.last_seen)} · {RULE_LABEL[item.rule] ?? item.rule}
        {item.intent && ` · 가장 가까운 블록 ${labelOf(item.intent)}${item.score !== null && item.score !== undefined ? ` ${Math.round(item.score * 100)}%` : ""}`}
      </p>
      {item.status === "pending" && (
        <div className="queue-actions">
          <label className="visually-hidden" htmlFor={id}>‘{item.text}’을 넣을 블록</label>
          <select id={id} className="input" value={target} onChange={(e) => setChosen(e.target.value)}>
            <option value="">블록 선택</option>
            {targets.map((t) => <option key={t.intent} value={t.intent}>{t.label}</option>)}
          </select>
          <button type="button" className="btn btn--primary" disabled={!target || draft.dirty || busy}
                  onClick={() => add.mutate()}>예문으로 추가</button>
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => mark.mutate("ignored")}>무시</button>
        </div>
      )}
      {item.status === "ignored" && (
        <div className="queue-actions">
          <span className="status">무시한 말이에요.</span>
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => mark.mutate("pending")}>되돌리기</button>
        </div>
      )}
      {item.status === "added" && <p className="status">‘{labelOf(item.status_intent)}’ 예문으로 넣었어요.</p>}
    </li>
  );
}

function Marks() {
  const draft = useDraft();
  const marks = useQuery({ queryKey: ["marks", draft.botId], queryFn: () => listMarks(draft.botId) });
  const targets = draft.doc ? targetsOf(draft.doc) : [];
  const labelOf = (intent: string | null | undefined) => targets.find((t) => t.intent === intent)?.label ?? intent ?? "—";
  if (marks.isError) return <ErrorNotice error={marks.error} onRetry={() => void marks.refetch()} />;
  if (!marks.data) return <p className="status" role="status">불러오는 중…</p>;
  if (marks.data.length === 0) return <p className="status">아직 처리한 말이 없어요.</p>;
  return (
    <ul className="queue" aria-label="학습이력">
      {marks.data.map((m, i) => (
        <li key={i} className="queue-item">
          <p className="queue-text">{m.text}</p>
          <p className="queue-meta">
            {m.status === "added" ? `‘${labelOf(m.intent)}’ 예문으로 추가` : m.status === "ignored" ? "무시" : "되돌림"} · {when(m.marked_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
