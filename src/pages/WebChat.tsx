import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { checkOrigins, getWeb, saveWeb, scriptSnippet, webviewUrl, type WebOut, type WebSettings } from "../api/web";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import "../styles/web.css";

const URLS_KEY = "chatbot-builder:web-urls";
const DEFAULT_URLS = {
  widget: (import.meta.env.VITE_WIDGET_URL as string | undefined) ?? "",
  engine: (import.meta.env.VITE_ENGINE_PUBLIC_URL as string | undefined) ?? "",
};

interface Form {
  origins: string; // one per line, as typed
  title: string; // "" = the bot's name
  color: string;
  placeholder: string;
}

const toForm = (web: WebOut): Form => ({
  origins: (web.allowed_origins ?? []).join("\n"), title: web.title ?? "", color: web.color, placeholder: web.placeholder,
});

function readUrls(): { widget: string; engine: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(URLS_KEY) ?? "null") as { widget?: unknown; engine?: unknown } | null;
    return {
      widget: typeof saved?.widget === "string" ? saved.widget : DEFAULT_URLS.widget,
      engine: typeof saved?.engine === "string" ? saved.engine : DEFAULT_URLS.engine,
    };
  } catch {
    return DEFAULT_URLS;
  }
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function Copy({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="copy">
      <pre className="copy__text" aria-label={label}>{text}</pre>
      <button type="button" className="btn btn--quiet" onClick={() => void copy()}>{state === "done" ? "복사했어요" : `${label} 복사`}</button>
      {state === "failed" && <p className="help" data-tone="error" role="alert">복사하지 못했어요. 위 글을 직접 선택해 복사해 주세요.</p>}
    </div>
  );
}

/** 웹 채팅: allowed sites, the chat window's look, and the code to embed it (engine E-G, chatbot-widget). */
export function WebChat() {
  const { botId, doc } = useDraft();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["web", botId], queryFn: () => getWeb(botId) });
  const [edited, setEdited] = useState<Form | null>(null); // null: showing what is saved
  const [urls, setUrls] = useState(readUrls);
  const ids = { origins: useId(), title: useId(), color: useId(), placeholder: useId(), widget: useId(), engine: useId() };

  useEffect(() => {
    try {
      localStorage.setItem(URLS_KEY, JSON.stringify(urls));
    } catch {
      // storage blocked: the addresses last for this page only
    }
  }, [urls]);

  const save = useMutation({
    mutationFn: (settings: WebSettings) => saveWeb(botId, settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(["web", botId], saved);
      setEdited(null);
    },
  });

  const form: Form | null = edited ?? (query.data ? toForm(query.data) : null);
  const label = typeof doc?.label === "string" && doc.label ? doc.label : botId;
  const check = checkOrigins(form?.origins ?? "");
  const settings: WebSettings | null = form && {
    allowed_origins: check.origins, title: form.title.trim() || null, color: form.color.toUpperCase(),
    placeholder: form.placeholder.trim(),
  };
  const changed = !!edited && !!query.data && JSON.stringify(toForm(query.data)) !== JSON.stringify(edited);
  const problems = [...check.problems, ...(form && !form.placeholder.trim() ? ["입력칸 안내 문구를 써 주세요."] : [])];
  const edit = (patch: Partial<Form>) => { if (form) { save.reset(); setEdited({ ...form, ...patch }); } };

  const widget = urls.widget.trim() || "https://위젯-주소";
  const engine = urls.engine.trim() || "https://엔진-주소";
  const widgetOrigin = originOf(urls.widget.trim());
  const missingWidget = widgetOrigin !== null && form !== null && !check.origins.includes(widgetOrigin);

  return (
    <>
      <header>
        <h1>웹 채팅</h1>
        <p>웹사이트나 앱 웹뷰에 이 봇의 채팅창을 붙여요. 여기 설정은 저장하면 바로 적용돼요(배포 필요 없음).</p>
      </header>
      {query.isPending && <p className="status" role="status">불러오는 중…</p>}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />}

      {form && (
        <form className="web-form" onSubmit={(e) => { e.preventDefault(); if (settings && problems.length === 0) save.mutate(settings); }}>
          <div className="field">
            <label htmlFor={ids.origins}>허용 도메인</label>
            <textarea id={ids.origins} className="input mono" rows={4} value={form.origins} aria-describedby={`${ids.origins}-help`}
                      aria-invalid={check.problems.length > 0} placeholder={"https://shop.example.com\nhttps://chat.example.com"}
                      onChange={(e) => edit({ origins: e.target.value })} />
            <p id={`${ids.origins}-help`} className="help">
              한 줄에 하나, 경로 없이 <span className="mono">https://example.com</span>처럼 써요(최대 20개). 여기 있는 사이트의 브라우저만 이 봇과 대화할 수 있어요.
              비워 두면 어떤 사이트에서도 붙일 수 없어요.
            </p>
          </div>
          <div className="field">
            <label htmlFor={ids.title}>채팅창 제목</label>
            <input id={ids.title} className="input" maxLength={40} value={form.title} placeholder={label}
                   aria-describedby={`${ids.title}-help`} onChange={(e) => edit({ title: e.target.value })} />
            <p id={`${ids.title}-help`} className="help">비워 두면 봇 이름(‘{label}’)이 보여요.</p>
          </div>
          <div className="field">
            <label htmlFor={ids.color}>색</label>
            <div className="web-color">
              <input id={ids.color} type="color" value={form.color.toLowerCase()} onChange={(e) => edit({ color: e.target.value.toUpperCase() })} />
              <span className="mono">{form.color.toUpperCase()}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor={ids.placeholder}>입력칸 안내 문구</label>
            <input id={ids.placeholder} className="input" maxLength={60} value={form.placeholder}
                   onChange={(e) => edit({ placeholder: e.target.value })} />
          </div>
          {problems.length > 0 && (
            <ul className="help web-problems" data-tone="error" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={!changed || problems.length > 0 || save.isPending} aria-busy={save.isPending}>
              {save.isPending ? "저장하는 중…" : "웹 채팅 저장"}
            </button>
            {save.isSuccess && !changed && <p className="status" role="status">저장했어요. 바로 적용돼요.</p>}
          </div>
          {save.isError && <ErrorNotice error={save.error} onRetry={() => settings && save.mutate(settings)} />}
        </form>
      )}

      <section className="web-embed" aria-labelledby="web-embed-title">
        <h2 id="web-embed-title">붙이는 법</h2>
        <p>위젯 파일(<span className="mono">chatbot.js</span>, <span className="mono">chat.html</span>)을 올린 주소와, 사용자가 닿는 엔진 주소를 넣으면 붙일 코드가 만들어져요. 이 두 주소는 이 브라우저에만 기억돼요.</p>
        <div className="field">
          <label htmlFor={ids.widget}>위젯 주소</label>
          <input id={ids.widget} className="input mono" value={urls.widget} placeholder="https://chat.example.com"
                 onChange={(e) => setUrls((u) => ({ ...u, widget: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor={ids.engine}>엔진 주소</label>
          <input id={ids.engine} className="input mono" value={urls.engine} placeholder="https://chat-api.example.com"
                 onChange={(e) => setUrls((u) => ({ ...u, engine: e.target.value }))} />
        </div>
        <h3>웹사이트</h3>
        <p>사이트의 <span className="mono">&lt;/body&gt;</span> 바로 앞에 넣으면 오른쪽 아래에 채팅 버튼이 생겨요. 그 사이트 주소가 허용 도메인에 있어야 해요.</p>
        <Copy label="웹사이트 코드" text={scriptSnippet(widget, engine, botId)} />
        <h3>앱 웹뷰</h3>
        <p>앱의 웹뷰에서 이 주소를 열어요. 닫기 버튼과 링크는 앱으로 알려요(위젯 README의 앱 연동).</p>
        <Copy label="웹뷰 주소" text={webviewUrl(widget, engine, botId)} />
        {missingWidget && widgetOrigin && (
          <p className="notice" data-tone="warn">
            웹뷰에서 쓰려면 위젯 주소 <span className="mono">{widgetOrigin}</span>도 허용 도메인에 있어야 해요.{" "}
            <button type="button" className="btn btn--quiet" onClick={() => edit({ origins: `${form?.origins.trim() ? `${form.origins.trim()}\n` : ""}${widgetOrigin}` })}>
              허용 도메인에 추가
            </button>
          </p>
        )}
      </section>
    </>
  );
}
