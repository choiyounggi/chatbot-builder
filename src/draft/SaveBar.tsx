import { ConflictError } from "../api/client";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "./DraftContext";

/** Unsaved changes, the save itself, and what the engine said about the saved draft. */
export function SaveBar() {
  const draft = useDraft();
  const problems = draft.lastSave && !draft.lastSave.valid ? draft.lastSave.errors : [];
  return (
    <div className="savebar-wrap">
      <div className="savebar" data-dirty={draft.dirty}>
        <p className="status" role="status">
          {draft.saving ? "저장 중…"
            : draft.dirty ? "저장 안 된 변경이 있어요"
            : draft.lastSave ? `저장했어요 · 리비전 ${draft.lastSave.revision}` : "변경 없음"}
        </p>
        <span className="spacer" />
        <button type="button" className="btn btn--quiet" onClick={draft.discard} disabled={!draft.dirty || draft.saving}>변경 취소</button>
        <button type="button" className="btn btn--primary" onClick={draft.save} disabled={!draft.dirty || draft.saving}
                aria-busy={draft.saving}>
          {draft.saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {draft.stale && !(draft.saveError instanceof ConflictError) && (
        <div className="notice" data-tone="warn" role="alert">
          <h2>다른 곳에서 초안이 바뀌었어요</h2>
          <p>지금 고친 내용은 예전 초안을 바탕으로 해요. 저장하면 덮어쓰지 않고 거절돼요. 최신 초안을 불러온 뒤 다시 고쳐 주세요.</p>
          <div className="actions"><button type="button" className="btn" onClick={draft.reload}>최신 초안 불러오기 (내 변경 버림)</button></div>
        </div>
      )}
      {draft.query.isRefetchError && (
        <div className="notice" data-tone="warn" role="alert">
          <h2>최신 초안을 불러오지 못했어요</h2>
          <p>지금 보이는 것은 마지막으로 불러온 초안이에요. 저장하면 다른 곳에서 바꾼 내용과 부딪힐 수 있어요.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => void draft.query.refetch()}>다시 불러오기</button></div>
        </div>
      )}
      {draft.saveError instanceof ConflictError && (
        <div className="notice" data-tone="warn" role="alert">
          <h2>다른 곳에서 먼저 저장했어요</h2>
          <p>다른 탭이나 다른 사람이 이 초안을 바꿨어요. 다시 불러오면 최신 초안이 보이고, 저장하지 않은 변경은 사라져요.</p>
          <div className="actions"><button type="button" className="btn" onClick={draft.reload}>최신 초안 다시 불러오기</button></div>
        </div>
      )}
      {draft.saveError != null && !(draft.saveError instanceof ConflictError) && (
        <ErrorNotice error={draft.saveError} onRetry={draft.save} />
      )}
      {problems.length > 0 && (
        <details className="notice" data-tone="warn" open>
          <summary>저장했지만 배포 전에 고칠 부분이 {problems.length}개 있어요</summary>
          <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
