// 작업이력 menu: what each draft save changed, newest first. docs/builder-plan.md §6 B4.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type ChangeOut, formatDateTime, listEdits } from "../api/deploy";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";

const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

const AREA_NOUN: Record<ChangeOut["area"], string> = {
  bot: "봇", settings: "설정", system: "시스템 블록", block: "블록", intent: "의도", entity: "엔티티", response: "응답", skill: "스킬",
};
const ACTION_VERB: Record<ChangeOut["action"], string> = { added: "추가", removed: "삭제", changed: "수정" };

/** One change as a short Korean line. A label falls back to the id when the engine left it empty. */
function describeChange(c: ChangeOut): string {
  const noun = AREA_NOUN[c.area];
  const verb = ACTION_VERB[c.action];
  let head: string;
  if (c.area === "system") {
    head = `${noun} ${verb}`;
  } else if (c.area === "block") {
    head = c.label ? `${noun} ‘${c.label}’(${c.id}) ${verb}` : `${noun} ${c.id} ${verb}`;
  } else {
    head = `${noun} ${c.label || c.id} ${verb}`;
  }
  if (c.area === "intent" && (c.examples_added != null || c.examples_removed != null)) {
    head += ` · 예문 +${c.examples_added ?? 0} −${c.examples_removed ?? 0}`;
  }
  return head;
}

export function Edits() {
  const { botId } = useDraft();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const edits = useQuery({ queryKey: ["edits", botId, limit], queryFn: () => listEdits(botId, limit), placeholderData: keepPreviousData });

  return (
    <>
      <header>
        <h1>작업이력</h1>
        <p>초안을 저장할 때마다 무엇이 바뀌었는지 남아요.</p>
      </header>
      {edits.isPending && (
        <div className="skeletons" role="status">
          <span className="visually-hidden">작업이력을 불러오는 중</span>
          <div className="skeleton" /><div className="skeleton" />
        </div>
      )}
      {edits.isError && <ErrorNotice error={edits.error} onRetry={() => void edits.refetch()} />}
      {edits.isSuccess && edits.data.items.length === 0 && (
        <div className="empty"><p>아직 저장한 기록이 없어요.</p></div>
      )}
      {edits.isSuccess && edits.data.items.length > 0 && (
        <>
          <ul className="edit-list">
            {edits.data.items.map((item) => (
              <li key={item.revision}>
                <p className="edit-head">리비전 {item.revision} · {formatDateTime(item.saved_at)}</p>
                <ul>
                  {item.changes.map((c, i) => <li key={i}>{describeChange(c)}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          {edits.data.items.length >= limit && limit < MAX_LIMIT && (
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}>
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
