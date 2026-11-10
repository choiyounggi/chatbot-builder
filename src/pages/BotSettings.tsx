import { useQuery } from "@tanstack/react-query";
import { listBots } from "../api/client";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import { DeployState } from "./BotList";

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
    </>
  );
}
