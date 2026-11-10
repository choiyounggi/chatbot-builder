import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { ConflictError, getDraft, listBots, saveDraft } from "../api/client";
import type { Draft, DraftSaved } from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { DeployState } from "./BotList";

export function BotSettings() {
  const { botId = "" } = useParams();
  return <SettingsFor key={botId} botId={botId} />; // a different bot starts from a clean slate
}

function SettingsFor({ botId }: { botId: string }) {
  const draft = useQuery({ queryKey: ["draft", botId], queryFn: () => getDraft(botId) });
  const bots = useQuery({ queryKey: ["bots"], queryFn: listBots });
  const summary = bots.data?.find((b) => b.id === botId);
  // lives here, not in the form: a successful save reloads the draft, which remounts the form
  const [saved, setSaved] = useState<DraftSaved | null>(null);

  return (
    <>
      <header>
        <h1>설정</h1>
        <p>봇의 기본 정보예요. 여기서 바꾼 내용은 초안에 저장되고, 배포해야 사용자에게 보여요.</p>
      </header>
      {draft.isPending && (
        <div className="skeletons" role="status">
          <span className="visually-hidden">초안을 불러오는 중</span>
          <div className="skeleton" /><div className="skeleton" />
        </div>
      )}
      {draft.isError && !draft.data && <ErrorNotice error={draft.error} onRetry={() => void draft.refetch()} />}
      {draft.data && (
        <>
          {draft.isRefetchError && (
            <div className="notice" data-tone="warn" role="alert">
              <h2>최신 초안을 불러오지 못했어요</h2>
              <p>아래는 마지막으로 불러온 초안이에요. 지금 저장하면 다른 곳에서 바꾼 내용과 부딪힐 수 있어요.</p>
              <div className="actions"><button type="button" className="btn" onClick={() => void draft.refetch()}>다시 불러오기</button></div>
            </div>
          )}
          <SettingsForm key={draft.data.etag} botId={botId} draft={draft.data} saved={saved} onSaved={setSaved}
                        onReload={() => { setSaved(null); void draft.refetch(); }} />
        </>
      )}
      <dl className="facts">
        <dt>봇 ID</dt><dd className="mono">{botId}</dd>
        <dt>배포 상태</dt><dd>{summary ? <DeployState bot={summary} /> : "—"}</dd>
        <dt>배포된 버전</dt><dd className="mono">{summary?.live ?? "—"}</dd>
        <dt>초안 리비전</dt><dd className="mono">{summary?.draft_revision ?? "—"}</dd>
      </dl>
    </>
  );
}

interface FormProps {
  botId: string;
  draft: Draft;
  saved: DraftSaved | null;
  onSaved: (result: DraftSaved | null) => void;
  onReload: () => void;
}

function SettingsForm({ botId, draft, saved, onSaved, onReload }: FormProps) {
  const queryClient = useQueryClient();
  const stored = typeof draft.document.label === "string" ? draft.document.label : "";
  const [label, setLabel] = useState(stored);
  const input = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () => saveDraft(botId, { ...draft.document, label: label.trim() }, draft.etag),
    onSuccess: async (result) => {
      onSaved(result);
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      await queryClient.invalidateQueries({ queryKey: ["draft", botId] });
    },
  });
  useEffect(() => {
    if (saved) input.current?.focus(); // remounted right after a save: keep the keyboard user in place
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount
  const changed = label.trim() !== stored;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!changed || save.isPending) return;
    onSaved(null);
    save.mutate();
  };

  return (
    <>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bot-label">봇 이름</label>
          <input id="bot-label" ref={input} className="input" value={label} onChange={(e) => setLabel(e.target.value)}
                 aria-describedby="bot-label-help" readOnly={save.isPending} aria-disabled={save.isPending} />
          <p id="bot-label-help" className="help">빌더와 봇 목록에 보이는 이름이에요. 비워 두면 봇 ID가 보여요.</p>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={!changed || save.isPending} aria-busy={save.isPending}>
            {save.isPending ? "저장 중…" : "저장"}
          </button>
          <p className="status" data-tone="ok" role="status">
            {saved && !changed ? `저장했어요 · 리비전 ${saved.revision}` : ""}
          </p>
        </div>
      </form>
      {save.error instanceof ConflictError && (
        <div className="notice" data-tone="warn" role="alert">
          <h2>다른 곳에서 먼저 저장했어요</h2>
          <p>다른 탭이나 다른 사람이 이 초안을 바꿨어요. 다시 불러오면 최신 초안이 보이고, 여기서 바꾼 이름은 사라져요.</p>
          <div className="actions"><button type="button" className="btn" onClick={onReload}>최신 초안 다시 불러오기</button></div>
        </div>
      )}
      {save.isError && !(save.error instanceof ConflictError) && (
        <ErrorNotice error={save.error} onRetry={() => { save.reset(); save.mutate(); }} />
      )}
      {saved && !saved.valid && (
        <div className="notice" data-tone="warn" role="alert">
          <h2>초안에 배포 전에 고칠 부분이 {saved.errors.length}개 있어요</h2>
          <p>이름은 저장됐어요. 아래 문제는 이번 변경과 상관없이 초안에 있던 것이에요.</p>
          <ul>{saved.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </>
  );
}
