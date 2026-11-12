import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { createBot, restoreBot } from "../api/bots";
import { ApiError, listBots } from "../api/client";
import { formatDateTime } from "../api/deploy";
import type { BotSummary } from "../api/types";
import { ErrorNotice } from "../components/ErrorNotice";
import { TopBar } from "../components/TopBar";

const BOT_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** The engine's id rule (`^[a-z][a-z0-9_]{0,63}$`), checked here so a bad id never round-trips. */
export function validateBotId(id: string): string | null {
  if (BOT_ID_PATTERN.test(id)) return null;
  if (!/^[a-z]/.test(id)) return "영문 소문자로 시작해야 해요";
  if (id.length > 64) return "64자를 넘을 수 없어요";
  return "소문자·숫자·밑줄만 쓸 수 있어요";
}

export function DeployState({ bot }: { bot: BotSummary }) {
  if (bot.live === null) return <span className="chip" data-tone="pending">배포 전 · 초안만 있음</span>;
  return (
    <span className="chips">
      <span className="chip" data-tone="live">배포됨 · v{bot.live_number}</span>
      {bot.undeployed_changes && <span className="chip" data-tone="pending">배포 안 된 변경</span>}
    </span>
  );
}

function NewBotForm({ bots, onCreated, onCancel }: { bots: BotSummary[]; onCreated: (id: string) => void; onCancel: () => void }) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"empty" | "copy">("empty");
  const [copyFrom, setCopyFrom] = useState("");
  const queryClient = useQueryClient();
  const copyCandidates = bots.filter((b) => !b.deletion);
  const idError = id.length > 0 ? validateBotId(id) : null;
  const canSubmit = id.length > 0 && !idError && label.length > 0 && (mode === "empty" || copyFrom.length > 0);

  const create = useMutation({
    mutationFn: () => createBot(id, label, mode === "copy" ? copyFrom : undefined),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      onCreated(created.bot);
    },
  });

  const reason = (() => {
    if (!(create.error instanceof ApiError)) return null;
    if (create.error.status === 409) return "이미 있는 ID예요(삭제 대기 중인 봇도 포함)";
    if (create.error.status === 404) return "복사할 봇의 초안이 없어요";
    if (create.error.status === 422) return create.error.message;
    return null;
  })();

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}>
      <div className="field">
        <label htmlFor="new-bot-id">봇 ID</label>
        <input id="new-bot-id" className="input mono" value={id} aria-describedby="new-bot-id-help" aria-invalid={!!idError}
               onChange={(e) => setId(e.target.value)} />
        <p id="new-bot-id-help" className="help" data-tone={idError ? "error" : undefined}>
          {idError ?? "영문 소문자로 시작, 소문자·숫자·밑줄 64자까지"}
        </p>
      </div>
      <div className="field">
        <label htmlFor="new-bot-label">이름</label>
        <input id="new-bot-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <fieldset className="group">
        <legend>시작 방법</legend>
        <label className="check">
          <input type="radio" name="new-bot-mode" checked={mode === "empty"} onChange={() => setMode("empty")} />
          빈 봇
        </label>
        <label className="check">
          <input type="radio" name="new-bot-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
          다른 봇 복사
        </label>
        {mode === "copy" && (
          <div className="field">
            <label htmlFor="new-bot-copy-from">복사할 봇</label>
            <select id="new-bot-copy-from" className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">고르세요</option>
              {copyCandidates.map((b) => <option key={b.id} value={b.id}>{b.label || b.id}</option>)}
            </select>
          </div>
        )}
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={!canSubmit || create.isPending} aria-busy={create.isPending}>
          {create.isPending ? "만드는 중…" : "만들기"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>취소</button>
      </div>
      {create.isError && (
        reason !== null
          ? <p className="notice" data-tone="error" role="alert">{reason}</p>
          : <ErrorNotice error={create.error} onRetry={() => create.mutate()} />
      )}
    </form>
  );
}

export function BotList() {
  const bots = useQuery({ queryKey: ["bots"], queryFn: listBots });
  const [formOpen, setFormOpen] = useState(false);
  const location = useLocation();
  // read once at mount: a notice passed by navigate() from another page (e.g. just deleted a bot)
  const [notice, setNotice] = useState<string | null>(() => (location.state as { notice?: string } | null)?.notice ?? null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // which row's restore is in flight (not the shared mutation's own isPending/variables: two rows can
  // be mid-request at once, and each must disable only its own button)
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (id: string) => restoreBot(id),
    onMutate: (id) => setRestoringId(id),
    onSettled: (_data, _error, id) => setRestoringId((current) => (current === id ? null : current)),
    onSuccess: (_restored, id) => {
      const label = bots.data?.find((b) => b.id === id)?.label || id;
      setNotice(`‘${label}’을(를) 되살렸어요`);
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
    },
  });

  return (
    <>
      <TopBar />
      <main className="page">
        <header>
          <h1>봇</h1>
          <p>봇을 골라 블록·엔티티·학습을 편집해요. 배포하기 전까지 사용자 대화에는 영향이 없어요.</p>
        </header>
        <div className="form-actions">
          <button type="button" className="btn btn--primary" aria-expanded={formOpen} disabled={!bots.isSuccess}
                  onClick={() => setFormOpen((o) => !o)}>
            새 봇
          </button>
        </div>
        {formOpen && bots.isSuccess && (
          <NewBotForm
            bots={bots.data}
            onCreated={(id) => { setFormOpen(false); void navigate(`/bots/${encodeURIComponent(id)}/settings`); }}
            onCancel={() => setFormOpen(false)}
          />
        )}
        {notice && <p className="status" role="status">{notice}</p>}
        {bots.isPending && (
          <div className="skeletons" role="status">
            <span className="visually-hidden">봇 목록을 불러오는 중</span>
            <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
          </div>
        )}
        {bots.isError && <ErrorNotice error={bots.error} onRetry={() => void bots.refetch()} />}
        {bots.isSuccess && bots.data.length === 0 && (
          <div className="empty">
            <p>아직 봇이 없어요.</p>
            <p>엔진을 봇 폴더와 함께 켜면 여기에 나타나요: <code>uv run python -m chatcore.api --bot bots/sample</code></p>
          </div>
        )}
        {bots.isSuccess && bots.data.length > 0 && (
          <table className="table stack-table">
            <thead>
              <tr><th scope="col">이름</th><th scope="col">ID</th><th scope="col">상태</th><th scope="col"><span className="visually-hidden">작업</span></th></tr>
            </thead>
            <tbody>
              {bots.data.map((bot) => (
                <tr key={bot.id}>
                  <td data-label="이름">
                    {bot.deletion
                      ? (bot.label || bot.id)
                      : <Link to={`/bots/${encodeURIComponent(bot.id)}/settings`}>{bot.label || bot.id}</Link>}
                  </td>
                  <td data-label="ID" className="mono">{bot.id}</td>
                  <td data-label="상태">
                    {bot.deletion ? (
                      <span className="chips">
                        <span className="chip" data-tone="pending">삭제 대기</span>
                        <span className="status">{`${formatDateTime(bot.deletion.purge_after)}에 영구 삭제`}</span>
                      </span>
                    ) : <DeployState bot={bot} />}
                  </td>
                  <td data-label="작업">
                    {bot.deletion && (
                      <button type="button" className="btn" onClick={() => restore.mutate(bot.id)}
                              disabled={restoringId === bot.id} aria-busy={restoringId === bot.id}>
                        되살리기
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {restore.isError && <ErrorNotice error={restore.error} onRetry={() => restore.mutate(restore.variables as string)} />}
      </main>
    </>
  );
}
