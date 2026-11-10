import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, testMessage, testOpen } from "../api/client";
import type { TestMessage, TestTurn } from "../api/types";
import { useDraft } from "../draft/DraftContext";
import { ErrorNotice } from "./ErrorNotice";
import { QuickReplies, RichMessage } from "./RichMessage";

type Line =
  | { from: "user" | "note"; text: string }
  | { from: "bot"; message: TestMessage; interactive: boolean; turn?: TestTurn };

const newSession = () => `t-${Math.random().toString(36).slice(2, 10)}`;

const botLines = (messages: TestMessage[], turn: TestTurn): Line[] =>
  messages.map((message, i) => ({ from: "bot", message, interactive: true, turn: i === messages.length - 1 ? turn : undefined }));

/** Chat with the newest test build of the saved draft, with what the engine decided each turn. */
export function TestPanel() {
  const draft = useDraft();
  const { build } = draft;
  const [session, setSession] = useState(newSession);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const currentBuild = build.status === "ready" ? build.build : null;
  const seen = useRef<string | null>(currentBuild);
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (currentBuild && seen.current && currentBuild !== seen.current) {
      setSession(newSession()); // a new build starts a new conversation
      setError(null);
      setLines((l) => [...l.map((line) => (line.from === "bot" ? { ...line, interactive: false } : line)), // old buttons belong to the old session
        { from: "note", text: "새 테스트 빌드로 바꿨어요. 대화를 새로 시작해요." }]);
    }
    seen.current = currentBuild ?? seen.current;
  }, [currentBuild]);

  // The conversation starts with the bot's welcome messages (if any). Guarded by build+session so
  // StrictMode's double-invoked effect, a new build, and "새 대화" each open exactly once.
  useEffect(() => {
    if (!currentBuild) return;
    const key = `${currentBuild}:${session}`;
    if (opened.current === key) return;
    opened.current = key;
    void (async () => {
      try {
        const turn = await testOpen(draft.botId, currentBuild, session);
        setLines((l) => [...l, ...botLines(turn.messages, turn)]);
      } catch (e) {
        setError(e);
      }
    })();
  }, [currentBuild, session, draft.botId]);

  /** Returns whether the message was sent. `blockId`: a quick reply or button asked to start that
   * block directly, without the engine trying to understand `message`. */
  const send = async (message: string, blockId?: string): Promise<boolean> => {
    if (!currentBuild || !message.trim() || busy) return false;
    setBusy(true);
    setError(null);
    setLines((l) => [...l, { from: "user", text: message }]);
    try {
      const turn = await testMessage(draft.botId, currentBuild, session, message, blockId);
      setLines((l) => [...l, ...botLines(turn.messages, turn)]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
    return true;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!currentBuild || !text.trim() || busy) return; // keep what was typed
    void send(text);
    setText("");
  };
  const lastBot = [...lines].reverse().find((l): l is Extract<Line, { from: "bot" }> => l.from === "bot");

  return (
    <div className="test-panel">
      <BuildStatus />
      <p className="visually-hidden" aria-live="polite">{lastBot?.message.text ?? ""}</p>
      <ol className="chat" aria-label="테스트 대화">
        {lines.map((line, i) => (
          <li key={i} className={`bubble bubble--${line.from}`}>
            {line.from === "bot" ? (
              <>
                <RichMessage message={line.message} interactive={line.interactive} disabled={!currentBuild || busy} onAction={(m, b) => void send(m, b)} />
                <QuickReplies message={line.message} interactive={line.interactive} disabled={!currentBuild || busy} onAction={(m, b) => void send(m, b)} />
                {line.turn && <TurnDebug turn={line.turn} />}
              </>
            ) : <p>{line.text}</p>}
          </li>
        ))}
      </ol>
      {error instanceof ApiError && error.status === 410 ? (
        <div className="notice" data-tone="warn" role="alert">
          <h2>테스트 빌드가 만료됐어요</h2>
          <p>30분 동안 쓰지 않은 빌드는 지워져요. 다시 만들면 이어서 테스트할 수 있어요.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => { setError(null); draft.rebuild(); }}>다시 빌드</button></div>
        </div>
      ) : error != null ? <ErrorNotice error={error} onRetry={() => setError(null)} /> : null}
      <form className="chat-input" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="test-text">테스트할 발화</label>
        <input id="test-text" className="input" value={text} onChange={(e) => setText(e.target.value)}
               placeholder={currentBuild ? "테스트할 발화를 입력하세요" : "저장하면 테스트 빌드가 만들어져요"} disabled={!currentBuild} />
        <button type="submit" className="btn btn--primary" disabled={!currentBuild || !text.trim() || busy}>보내기</button>
      </form>
      <button type="button" className="btn btn--quiet" onClick={() => { setSession(newSession()); setLines([]); setError(null); }}>새 대화</button>
    </div>
  );
}

function BuildStatus() {
  const { build, dirty, rebuild, query } = useDraft();
  let text: string;
  if (build.status === "building") text = "테스트 빌드를 만드는 중…";
  else if (build.status === "ready") text = `테스트 빌드 ${build.build.slice(0, 7)} 준비됨`;
  else if (build.status === "failed") {
    const error = build.job?.error;
    text = `테스트 빌드 실패: ${typeof error?.detail === "string" ? error.detail : "엔진 로그를 확인해 주세요"}`;
  } else text = "아직 테스트 빌드가 없어요";
  return (
    <div className="build-status">
      <p className="status" role="status" data-tone={build.status === "ready" ? "ok" : undefined}>{text}</p>
      {dirty && <p className="help" data-tone="warn">저장 안 된 변경은 테스트에 반영되지 않아요.</p>}
      {build.status !== "building" && (
        <button type="button" className="btn" onClick={rebuild} disabled={!query.data}>
          {build.status === "none" ? "지금 저장된 초안으로 빌드" : "다시 빌드"}
        </button>
      )}
    </div>
  );
}

function TurnDebug({ turn }: { turn: TestTurn }) {
  const nlu = turn.nlu ?? {};
  const intents = Array.isArray(nlu.intents) ? (nlu.intents as [string, number][]) : [];
  return (
    <details className="debug">
      <summary>엔진이 판단한 것</summary>
      <dl className="facts">
        <dt>규칙</dt><dd className="mono">{String(nlu.rule ?? "—")}</dd>
        <dt>매칭</dt><dd className="mono">{String(nlu.matched_by ?? "—")}</dd>
        <dt>의도</dt><dd className="mono">{intents.map(([name, score]) => `${name} ${score.toFixed(2)}`).join(" · ") || "—"}</dd>
        <dt>진행 중</dt><dd className="mono">{turn.stack.map((f) => `${f.scenario}${f.awaiting ? ` (${f.awaiting} 기다림)` : ""}`).join(" > ") || "없음"}</dd>
        {turn.actions.length > 0 && <><dt>스킬</dt><dd className="mono">{turn.actions.map((a) => `${a.action} ${a.ok ? "성공" : "실패"}`).join(" · ")}</dd></>}
      </dl>
    </details>
  );
}
