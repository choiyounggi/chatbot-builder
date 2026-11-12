import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { deleteBot } from "../api/bots";
import { ApiError, listBots } from "../api/client";
import { formatDateTime } from "../api/deploy";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import "../styles/bots.css";
import { DeployState } from "./BotList";

function DeleteBotSection({ botId, label }: { botId: string; label: string }) {
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState("");
  const del = useMutation({
    mutationFn: () => deleteBot(botId),
    onSuccess: (deleted) => {
      void navigate("/", {
        state: { notice: `‘${label || botId}’ 봇을 삭제했어요. ${formatDateTime(deleted.purge_after)}에 영구 삭제돼요.` },
      });
    },
  });
  const canDelete = confirmId === botId;

  return (
    <section className="danger-zone" aria-label="봇 삭제">
      <h2>봇 삭제</h2>
      <p>삭제하면 사용자에게 바로 답하지 않게 돼요.</p>
      <p>7일 뒤 초안·버전·지식베이스·대화 기록까지 모두 영구 삭제돼요.</p>
      <p>그 전에는 봇 목록에서 되살릴 수 있어요.</p>
      <div className="field">
        <label htmlFor="delete-confirm-id">삭제할 봇 ID 입력</label>
        <input id="delete-confirm-id" className="input mono" value={confirmId} aria-describedby="delete-confirm-id-help"
               onChange={(e) => setConfirmId(e.target.value)} />
        <p id="delete-confirm-id-help" className="help">확인을 위해 봇 ID <span className="mono">{botId}</span>를 입력하세요.</p>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--danger" disabled={!canDelete || del.isPending} aria-busy={del.isPending}
                onClick={() => del.mutate()}>
          {del.isPending ? "삭제하는 중…" : "봇 삭제"}
        </button>
      </div>
      {del.isError && (
        del.error instanceof ApiError && del.error.status === 409
          ? <p className="notice" data-tone="error" role="alert">이미 삭제 대기 중이에요.</p>
          : <ErrorNotice error={del.error} onRetry={() => del.mutate()} />
      )}
    </section>
  );
}

export function BotSettings() {
  const draft = useDraft();
  const bots = useQuery({ queryKey: ["bots"], queryFn: listBots });
  const summary = bots.data?.find((b) => b.id === draft.botId);
  const label = typeof draft.doc?.label === "string" ? draft.doc.label : "";

  return (
    <>
      <header>
        <h1>설정</h1>
        <p>봇의 기본 정보예요. 바꾼 내용은 위의 저장 버튼으로 초안에 저장되고, 배포해야 사용자에게 보여요.</p>
      </header>
      {!draft.doc && draft.query.isError && <ErrorNotice error={draft.query.error} onRetry={() => void draft.query.refetch()} />}
      {draft.doc && (
        <div className="field">
          <label htmlFor="bot-label">봇 이름</label>
          <input id="bot-label" className="input" value={label} aria-describedby="bot-label-help"
                 onChange={(e) => draft.update((d) => ({ ...d, label: e.target.value }))} />
          <p id="bot-label-help" className="help">빌더와 봇 목록에 보이는 이름이에요. 비워 두면 봇 ID가 보여요.</p>
        </div>
      )}
      <dl className="facts">
        <dt>봇 ID</dt><dd className="mono">{draft.botId}</dd>
        <dt>배포 상태</dt><dd>{summary ? <DeployState bot={summary} /> : "—"}</dd>
        <dt>배포된 버전</dt><dd className="mono">{summary?.live ?? "—"}</dd>
        <dt>초안 리비전</dt><dd className="mono">{summary?.draft_revision ?? "—"}</dd>
      </dl>
      {draft.doc && <DeleteBotSection botId={draft.botId} label={label} />}
    </>
  );
}
