import { useQueryClient } from "@tanstack/react-query";
import { ApiError, AuthError, EngineUnreachable } from "../api/client";
import { TokenForm } from "./TokenForm";

/** What went wrong, and the one thing to do about it. Never render inside a <form>. */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const queryClient = useQueryClient();
  if (error instanceof AuthError) {
    return (
      <TokenForm rejected={error.sentToken} onSaved={() => {
        void queryClient.invalidateQueries();
        onRetry();
      }} />
    );
  }
  let title = "요청을 처리하지 못했어요";
  let detail = "잠시 후 다시 시도해 주세요. 계속되면 엔진 로그를 확인해 주세요.";
  let retry = true;
  let problems: string[] = [];
  if (error instanceof EngineUnreachable) {
    title = "엔진에 연결할 수 없어요";
    detail = "엔진이 127.0.0.1:8000에서 실행 중인지 확인해 주세요 (엔진 레포에서 make serve).";
  } else if (error instanceof ApiError && error.status === 404) {
    title = "찾을 수 없어요";
    detail = "봇이 없거나 아직 초안이 없어요. 봇 목록에서 다시 골라 주세요.";
    retry = false;
  } else if (error instanceof ApiError && error.status === 422) {
    title = "엔진이 이 내용을 받지 않았어요";
    detail = "아래 문제를 고친 뒤 다시 저장해 주세요.";
    problems = error.problems;
    retry = false;
  } else if (error instanceof ApiError && (error.status === 400 || error.status === 428)) {
    title = "빌더가 잘못된 요청을 보냈어요";
    detail = "페이지를 새로 고친 뒤 다시 해 주세요. 계속되면 빌더의 버그예요.";
    retry = false;
  } else if (error instanceof ApiError && error.status === 503) {
    title = "엔진 저장소가 잠시 응답하지 않아요";
    detail = "데이터베이스 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  return (
    <div className="notice" data-tone="error" role="alert">
      <h2>{title}</h2>
      <p>{detail}</p>
      {problems.length > 0 && <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {error instanceof ApiError && <p className="status mono">HTTP {error.status}</p>}
      {retry && (
        <div className="actions">
          <button type="button" className="btn" onClick={onRetry}>다시 시도</button>
        </div>
      )}
    </div>
  );
}
