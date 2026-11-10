// 배포 menu: versions, training a deployable version, deploy, rollback, deploy history.
// docs/builder-plan.md §6 B4.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, getJob } from "../api/client";
import {
  type ConfusablePair,
  deployVersion,
  formatDateTime,
  listVersions,
  parseVersionJobError,
  parseVersionJobResult,
  rollbackVersion,
  startVersionJob,
  type VersionJobError,
  type VersionJobResult,
  type VersionThresholds,
} from "../api/deploy";
import { listBlocks } from "../model/blocks";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import "../styles/deploy.css";

const NOTE_MAX = 100;

const fmtF1 = (f: number | null) => (f !== null ? f.toFixed(2) : "—");

/** Why the engine refused a deploy or rollback (404/409), in Korean. */
export function deployRefusal(error: ApiError): string {
  if (/no earlier deployment/.test(error.message)) return "되돌릴 이전 배포가 없어요";
  if (/no trained model/.test(error.message)) return "그 버전의 모델 파일이 없어요. 다시 학습한 뒤 배포해 주세요.";
  if (/cannot run here/.test(error.message)) return `그 버전은 지금 엔진에서 돌릴 수 없어요: ${error.problems.join(", ") || error.message}`;
  if (error.status === 404) return "그 버전을 찾지 못했어요. 버전 목록을 새로고쳐 주세요.";
  return error.message;
}

/** A block's name for an intent id (falls back to the id). */
function useIntentLabel(): (intent: string) => string {
  const { doc } = useDraft();
  return (intent) => (doc ? listBlocks(doc).find((b) => b.intent === intent)?.label : undefined) || intent;
}

function LowestIntents({ data }: { data: Record<string, number> | null }) {
  const labelOf = useIntentLabel();
  if (!data) return null;
  const lowest = Object.entries(data).sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (lowest.length === 0) return null;
  return (
    <div>
      <h3>블록별 F1 (낮은 다섯 개)</h3>
      <ul>
        {lowest.map(([intent, f1]) => (
          <li key={intent}>{labelOf(intent)} <span className="mono status">{intent}</span> · {f1.toFixed(2)}</li>
        ))}
      </ul>
    </div>
  );
}

function Thresholds({ t }: { t: VersionThresholds | null }) {
  if (!t) return null;
  return (
    <dl className="facts">
      <dt>목표 단계</dt><dd>{t.levelLabel}</dd>
      <dt>의도 임계값</dt><dd className="mono">{fmtF1(t.intentThreshold)}</dd>
      <dt>유사도 임계값</dt><dd className="mono">{fmtF1(t.similarityThreshold)}</dd>
      <dt>모호함 여유</dt><dd className="mono">{fmtF1(t.ambiguityMargin)}</dd>
    </dl>
  );
}

function Confusable({ pairs }: { pairs: ConfusablePair[] }) {
  const labelOf = useIntentLabel();
  if (pairs.length === 0) return null;
  return (
    <div>
      <h3>헷갈리는 블록</h3>
      <ul>
        {pairs.map((p, i) => <li key={i}>{p.label.split(" ↔ ").map(labelOf).join(" ↔ ")}{p.score !== null ? ` · ${p.score.toFixed(2)}` : ""}</li>)}
      </ul>
    </div>
  );
}

function TrainResult({ result }: { result: VersionJobResult }) {
  return (
    <div className="train-result">
      <p>macro-F1 <strong className="mono">{fmtF1(result.macroF1)}</strong>
        {result.clarifyRate !== null && <> · 되묻기 비율 <span className="mono">{fmtF1(result.clarifyRate)}</span></>}
      </p>
      <LowestIntents data={result.perIntentF1} />
      {result.warnings.length > 0 && (
        <div>
          <h3>주의할 점</h3>
          <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <Thresholds t={result.thresholds} />
      <Confusable pairs={result.confusable} />
    </div>
  );
}

/** The engine's training failure in Korean, naming blocks by their labels (the detail stays for anything else). */
export function trainingMessage(detail: string, labelOf: (intent: string) => string): string {
  const few = /at least (\d+) examples[^[]*\[([^\]]*)\]/.exec(detail);
  if (few) {
    const names = (few[2] ?? "").split(",").map((n) => n.trim().replace(/^'|'$/g, "")).filter(Boolean).map(labelOf);
    return `예문이 ${few[1]}개보다 적은 블록이 있어 배포용 학습을 할 수 없어요: ${names.join(", ")}. 블록마다 예문을 ${few[1]}개 이상 넣어 주세요.`;
  }
  if (/at least two intents/.test(detail)) return "학습할 블록이 둘 이상 있어야 해요.";
  return detail;
}

function TrainError({ error }: { error: VersionJobError }) {
  const labelOf = useIntentLabel();
  return (
    <div className="notice" data-tone="error" role="alert">
      <h2>학습하지 못했어요</h2>
      {error.kind === "invalid_draft" && (
        <>
          <p>저장된 초안에 문제가 있어요.</p>
          <ul>{error.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </>
      )}
      {error.kind === "below_bar" && (
        <>
          <p>교차검증 정확도(macro-F1)가 배포 기준보다 낮아 버전을 만들지 않았어요. 점수가 낮은 블록에 예문을 더 넣어 보세요.</p>
          <p className="mono status">{error.detail}</p>
          <LowestIntents data={error.perIntentF1} />
        </>
      )}
      {error.kind === "training" && <p>{trainingMessage(error.detail, labelOf)}</p>}
      {error.kind === "no_draft" && <p>저장된 초안이 없어요. 블록을 만들고 저장한 뒤 다시 시도해 주세요.</p>}
      {error.kind === "unknown" && <p>{error.detail ?? "원인을 알 수 없어요."}</p>}
    </div>
  );
}

export function Deploy() {
  const draft = useDraft();
  const botId = draft.botId;
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: ["versions", botId], queryFn: () => listVersions(botId) });

  // kept in the query cache, not in the page: leaving 배포 and coming back keeps following the job
  const jobKey = ["versionJobId", botId];
  const jobId = useQuery({ queryKey: jobKey, queryFn: () => null as string | null, initialData: null, staleTime: Infinity, gcTime: Infinity }).data;
  const train = useMutation({
    mutationFn: () => startVersionJob(botId),
    onSuccess: (job) => queryClient.setQueryData(jobKey, job.id),
  });
  const job = useQuery({
    queryKey: ["versionJob", jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.status === "error" || (q.state.data && ["done", "failed"].includes(q.state.data.status)) ? false : 400),
  });
  const training = train.isPending || (jobId !== null && !job.isError && (!job.data || job.data.status === "queued" || job.data.status === "running"));
  const trainResult = job.data?.status === "done" ? parseVersionJobResult(job.data.result as Record<string, unknown> | null) : null;
  const trainError = job.data?.status === "failed" ? parseVersionJobError(job.data.error as Record<string, unknown> | null) : null;

  const [selectedVersion, setSelectedVersion] = useState("");
  const refreshedForJob = useRef<string | null>(null);
  useEffect(() => {
    if (job.data?.status === "done" && refreshedForJob.current !== job.data.id) {
      refreshedForJob.current = job.data.id;
      void queryClient.invalidateQueries({ queryKey: ["versions", botId] });
    }
  }, [job.data, queryClient, botId]);

  const list = versions.data?.versions ?? [];
  const defaultVersion = list[0]?.version ?? ""; // the newest: never a silent downgrade
  const [note, setNote] = useState("");
  const made = job.data?.status === "done" ? job.data.result?.version : undefined; // what the training just made
  const trained = typeof made === "string" && list.some((v) => v.version === made) ? made : "";
  const effectiveVersion = selectedVersion || trained || defaultVersion;
  const selectedLive = list.find((v) => v.version === effectiveVersion)?.live ?? false;
  const [deployedMessage, setDeployedMessage] = useState<string | null>(null);
  const deploy = useMutation({
    mutationFn: () => deployVersion(botId, effectiveVersion, note),
    onSuccess: () => {
      const deployedNumber = list.find((v) => v.version === effectiveVersion)?.number;
      setDeployedMessage(deployedNumber !== undefined ? `v${deployedNumber} 배포됨` : "배포됐어요");
      setRollbackMessage(null);
      setNote("");
      setSelectedVersion("");
      void queryClient.invalidateQueries({ queryKey: ["versions", botId] });
    },
  });

  const history = versions.data?.history ?? [];
  const canRollback = history.length > 1 && history.slice(1).some((h) => h.version !== history[0]?.version);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);
  const rollback = useMutation({
    mutationFn: () => rollbackVersion(botId),
    onSuccess: () => {
      setRollbackMessage("이전 버전으로 되돌렸어요");
      setDeployedMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["versions", botId] });
    },
  });
  const onRollbackClick = () => {
    if (window.confirm("이전 버전으로 되돌릴까요? 사용자 대화가 그 버전으로 바뀌어요.")) rollback.mutate();
  };

  const trainStatusText = training ? "배포용 학습을 진행하고 있어요…"
    : trainResult ? `학습을 마쳤어요 · macro-F1 ${fmtF1(trainResult.macroF1)}`
    : trainError ? "학습하지 못했어요"
    : job.isError ? "학습 상태를 확인하지 못했어요"
    : "아직 학습을 시작하지 않았어요";

  return (
    <>
      <header>
        <h1>배포</h1>
        <p>저장된 초안을 학습해서 버전을 만들고, 버전을 골라 배포해요. 배포해야 사용자 대화에 반영돼요.</p>
      </header>

      <section>
        <h2>버전</h2>
        {versions.isPending && (
          <div className="skeletons" role="status">
            <span className="visually-hidden">버전 목록을 불러오는 중</span>
            <div className="skeleton" /><div className="skeleton" />
          </div>
        )}
        {versions.isError && <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} />}
        {versions.isSuccess && list.length === 0 && (
          <div className="empty"><p>아직 학습된 버전이 없어요. 아래에서 배포용 학습을 시작해 보세요.</p></div>
        )}
        {versions.isSuccess && list.length > 0 && (
          <table className="table stack-table">
            <thead>
              <tr><th scope="col">버전</th><th scope="col">생성 시각</th><th scope="col">macro-F1</th><th scope="col">상태</th></tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.version}>
                  <td data-label="버전"><span className="mono">v{v.number}</span></td>
                  <td data-label="생성 시각">{formatDateTime(v.created_at)}</td>
                  <td data-label="macro-F1" className="mono">{fmtF1(v.macro_f1)}</td>
                  <td data-label="상태">{v.live && <span className="chip" data-tone="live">라이브</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>배포용 학습</h2>
        {draft.dirty && <p className="help" data-tone="warn">저장된 초안만 학습돼요. 지금 화면의 변경은 아직 저장되지 않았어요.</p>}
        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={() => train.mutate()} disabled={training} aria-busy={training}>
            {training ? "학습 중…" : "배포용 학습"}
          </button>
        </div>
        <p className="status" role="status">{trainStatusText}</p>
        {train.isError && <ErrorNotice error={train.error} onRetry={() => train.mutate()} />}
        {job.isError && <ErrorNotice error={job.error} onRetry={() => void job.refetch()} />}
        {trainResult && <TrainResult result={trainResult} />}
        {trainError && <TrainError error={trainError} />}
      </section>

      <section>
        <h2>배포</h2>
        {list.length > 0 ? (
          <form className="form" onSubmit={(e) => { e.preventDefault(); deploy.mutate(); }}>
            <div className="field">
              <label htmlFor="deploy-version">배포할 버전</label>
              <select id="deploy-version" className="input" value={effectiveVersion} onChange={(e) => setSelectedVersion(e.target.value)}>
                {list.map((v) => <option key={v.version} value={v.version}>v{v.number}{v.live ? " · 라이브" : ""}</option>)}
              </select>
              {selectedLive && <p className="help">이 버전은 지금 배포되어 있어요.</p>}
            </div>
            <div className="field">
              <label htmlFor="deploy-note">메모 (선택)</label>
              <input id="deploy-note" className="input" maxLength={NOTE_MAX} value={note}
                     onChange={(e) => setNote(e.target.value)} aria-describedby="deploy-note-help" />
              <p id="deploy-note-help" className="help">{note.length}/{NOTE_MAX}자</p>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={deploy.isPending} aria-busy={deploy.isPending}>
                {deploy.isPending ? "배포하는 중…" : "배포"}
              </button>
            </div>
          </form>
        ) : (
          <p className="help">학습된 버전이 있어야 배포할 수 있어요.</p>
        )}
        <p className="status" role="status">{deployedMessage ?? "아직 배포하지 않았어요"}</p>
        {deploy.isError && (
          deploy.error instanceof ApiError && (deploy.error.status === 404 || deploy.error.status === 409)
            ? <p className="notice" data-tone="error" role="alert">{deployRefusal(deploy.error)}</p>
            : <ErrorNotice error={deploy.error} onRetry={() => deploy.mutate()} />
        )}
      </section>

      <section>
        <h2>이전 버전으로 되돌리기</h2>
        <p className="help">지금 배포된 버전을 끄고 바로 전에 배포했던 버전으로 돌아가요.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onRollbackClick} disabled={!canRollback || rollback.isPending} aria-busy={rollback.isPending}>
            {rollback.isPending ? "되돌리는 중…" : "이전 버전으로 되돌리기"}
          </button>
        </div>
        <p className="status" role="status">{rollbackMessage ?? "아직 되돌리지 않았어요"}</p>
        {rollback.isError && (
          rollback.error instanceof ApiError && rollback.error.status === 409
            ? <p className="notice" data-tone="error" role="alert">{deployRefusal(rollback.error)}</p>
            : <ErrorNotice error={rollback.error} onRetry={() => rollback.mutate()} />
        )}
      </section>

      <section>
        <h2>배포 히스토리</h2>
        {history.length === 0 ? (
          <div className="empty"><p>아직 배포한 적이 없어요.</p></div>
        ) : (
          <table className="table stack-table">
            <thead>
              <tr><th scope="col">버전</th><th scope="col">메모</th><th scope="col">배포 시각</th><th scope="col">상태</th></tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={`${h.version}-${i}`}>
                  <td data-label="버전" className="mono">v{h.number}</td>
                  <td data-label="메모">{h.note === "rollback" ? "되돌리기" : h.note || "메모 없음"}</td>
                  <td data-label="배포 시각">{formatDateTime(h.deployed_at)}</td>
                  <td data-label="상태">{h.version === versions.data?.live && <span className="chip" data-tone="live">라이브</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
