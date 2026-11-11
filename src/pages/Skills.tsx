// 스킬: the list and editor of HTTP skills (engine E10), their test run, error log and secrets.
// docs/builder-plan.md §6 B5.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import "../styles/skills.css";
import { ApiError } from "../api/client";
import {
  deleteSecret, listSecrets, listSkillErrors, setSecret, skillErrorMessage, testSkill, type SkillTestOut,
} from "../api/skills";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import { type BotDoc, SKILL_TIMEOUT, type SkillDoc, without } from "../model/doc";
import {
  addSkill, listSkills, removeSkill, SECRET_NAME_PATTERN, skillUsedBy, validateHeaderName, validateHeaderValue,
  validateUrl, writeSkill,
} from "../model/skills";

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

export function Skills() {
  const [tab, setTab] = useState<"list" | "errors" | "secrets">("list");
  return (
    <>
      <header>
        <h1>스킬</h1>
        <p>블록이 부르는 HTTP 요청이에요. 저장하면 블록에서 쓸 수 있고, 테스트 실행으로 바로 확인할 수 있어요.</p>
      </header>
      <div className="tabs" role="group" aria-label="스킬 화면">
        <button type="button" className="btn" aria-pressed={tab === "list"} onClick={() => setTab("list")}>스킬 목록</button>
        <button type="button" className="btn" aria-pressed={tab === "errors"} onClick={() => setTab("errors")}>오류 내역</button>
        <button type="button" className="btn" aria-pressed={tab === "secrets"} onClick={() => setTab("secrets")}>비밀값</button>
      </div>
      {tab === "list" ? <SkillsList /> : tab === "errors" ? <ErrorLog /> : <Secrets />}
    </>
  );
}

function SkillsList() {
  const draft = useDraft();
  const [selected, setSelected] = useState<string | null>(null);
  const doc = draft.doc;
  if (!doc) {
    return draft.query.isError
      ? <ErrorNotice error={draft.query.error} onRetry={() => void draft.query.refetch()} />
      : <div className="skeletons" role="status"><span className="visually-hidden">초안을 불러오는 중</span><div className="skeleton" /><div className="skeleton" /></div>;
  }
  const rows = listSkills(doc);
  const create = () => {
    const { doc: next, id } = addSkill(doc);
    draft.update(() => next);
    setSelected(id);
  };
  return (
    <div className="split">
      <section className="blocklist" aria-label="스킬 목록">
        <button type="button" className="btn" onClick={create}>새 스킬</button>
        <ul aria-label="스킬">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="skill-row" aria-current={r.id === selected ? "true" : undefined}
                      onClick={() => setSelected(r.id)}>
                <span className="name">{r.label}</span>
                <span className="meta">{r.host || "주소 없음"} · 연결된 블록 {r.usedBy}개</span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="status">아직 스킬이 없어요. 새 스킬을 만들어 보세요.</p>}
      </section>
      {selected && doc.skills?.[selected]
        ? <SkillEditor key={selected} id={selected} onDeleted={() => setSelected(null)} />
        : <section className="editor empty"><p>왼쪽에서 스킬을 고르거나 새 스킬을 만드세요.</p></section>}
    </div>
  );
}

function SkillEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const draft = useDraft();
  const doc = draft.doc as BotDoc;
  const skill = doc.skills?.[id] as SkillDoc;
  const [problem, setProblem] = useState<string | null>(null);
  // what is being typed while it is not a valid number (null: show the draft's value)
  const [timeoutText, setTimeoutText] = useState<string | null>(null);
  const shownTimeout = timeoutText ?? String(skill.timeout_ms ?? SKILL_TIMEOUT.default);
  const timeoutValid = /^\d+$/.test(shownTimeout) && Number(shownTimeout) >= SKILL_TIMEOUT.min && Number(shownTimeout) <= SKILL_TIMEOUT.max;
  const secrets = useQuery({ queryKey: ["secrets", draft.botId], queryFn: () => listSecrets(draft.botId) });

  const change = (patch: Partial<SkillDoc>) => draft.update((d) => (d.skills?.[id] ? writeSkill(d, id, { ...d.skills[id], ...patch }) : d));
  const urlError = validateUrl(skill.url);
  const testUrlError = validateUrl(skill.test_url ?? "", false);

  const remove = () => {
    const used = skillUsedBy(doc, id);
    if (used.length > 0) {
      setProblem(`이 스킬을 쓰는 블록이 있어요: ${used.join(", ")}. 그곳에서 먼저 빼 주세요.`);
      return;
    }
    draft.update((d) => (skillUsedBy(d, id).length > 0 ? d : removeSkill(d, id)));
    onDeleted();
  };

  return (
    <section className="editor" aria-label={`스킬 ${skill.label || id}`}>
      <div className="editor-head">
        <div className="field">
          <label htmlFor="skill-label">이름</label>
          <input id="skill-label" className="input" value={skill.label ?? ""} onChange={(e) => change({ label: e.target.value })} />
        </div>
        <span className="mono status">{id}</span>
        <button type="button" className="btn btn--quiet" onClick={remove}>스킬 삭제</button>
      </div>
      {problem && <p className="notice" data-tone="warn" role="alert">{problem}</p>}

      <div className="field">
        <label htmlFor="skill-url">URL</label>
        <input id="skill-url" className="input" aria-invalid={!!urlError} aria-describedby="skill-url-help"
               value={skill.url} onChange={(e) => change({ url: e.target.value })} />
        <p id="skill-url-help" className="help" data-tone={urlError ? "error" : undefined}>{urlError ?? "블록이 이 주소로 요청을 보내요."}</p>
      </div>

      <div className="field">
        <label htmlFor="skill-test-url">테스트 URL (선택)</label>
        <input id="skill-test-url" className="input" aria-invalid={!!testUrlError} aria-describedby="skill-test-url-help"
               value={skill.test_url ?? ""} onChange={(e) => change({ test_url: e.target.value || undefined })} />
        <p id="skill-test-url-help" className="help" data-tone={testUrlError ? "error" : undefined}>
          {testUrlError ?? "테스트 실행에서만 이 주소를 써요. 비워 두면 URL을 그대로 써요."}
        </p>
      </div>

      <div className="field">
        <label htmlFor="skill-timeout">시간 제한(ms)</label>
        <input id="skill-timeout" className="input" inputMode="numeric" aria-invalid={!timeoutValid} aria-describedby="skill-timeout-help"
               value={shownTimeout}
               onChange={(e) => {
                 const raw = e.target.value;
                 const ms = Number(raw);
                 if (/^\d+$/.test(raw) && ms >= SKILL_TIMEOUT.min && ms <= SKILL_TIMEOUT.max) {
                   setTimeoutText(null);
                   change({ timeout_ms: ms });
                 } else setTimeoutText(raw);
               }} />
        <p id="skill-timeout-help" className="help" data-tone={timeoutValid ? undefined : "error"}>
          {timeoutValid ? `${SKILL_TIMEOUT.min}~${SKILL_TIMEOUT.max}ms 사이로 설정돼요.`
            : `${SKILL_TIMEOUT.min}~${SKILL_TIMEOUT.max} 사이의 정수를 넣어 주세요. 지금은 ${skill.timeout_ms ?? SKILL_TIMEOUT.default}ms로 저장돼요.`}
        </p>
      </div>

      <HeaderFields id={id} skill={skill} secretNames={(secrets.data ?? []).map((s) => s.name)} />
      <SkillTest id={id} />
    </section>
  );
}

function HeaderFields({ id, skill, secretNames }: { id: string; skill: SkillDoc; secretNames: string[] }) {
  const draft = useDraft();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const headers = skill.headers ?? {};
  const nameProblem = name ? (validateHeaderName(name) ?? (name in headers ? "이미 있는 헤더예요" : null)) : null;
  const valueProblem = value ? validateHeaderValue(value) : null;
  const write = (next: Record<string, string>) => draft.update((d) => (d.skills?.[id] ? writeSkill(d, id, { ...d.skills[id], headers: next }) : d));
  const insertSecret = (current: string, secret: string) => `${current}{{ secret.${secret} }}`;
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name || nameProblem || valueProblem) return;
    write({ ...headers, [name]: value });
    setName("");
    setValue("");
  };
  const rows = Object.entries(headers);
  return (
    <fieldset className="group">
      <legend>헤더</legend>
      <p className="status">요청에 함께 보낼 헤더예요. 값에서 {"{{ secret.이름 }}"}으로 비밀값을 쓸 수 있어요.</p>
      {rows.length === 0 && <p className="status">아직 헤더가 없어요.</p>}
      <ul className="header-rows">
        {rows.map(([n, v]) => {
          const rowError = validateHeaderValue(v);
          return (
            <li className="header-row" key={n}>
              <span className="mono">{n}</span>
              <label className="visually-hidden" htmlFor={`header-${n}-value`}>{n} 값</label>
              <input id={`header-${n}-value`} className="input" aria-invalid={!!rowError}
                     value={v} onChange={(e) => write({ ...headers, [n]: e.target.value })} />
              <label className="visually-hidden" htmlFor={`header-${n}-secret`}>{n}에 비밀값 넣기</label>
              <select id={`header-${n}-secret`} className="input" value=""
                      onChange={(e) => { if (e.target.value) write({ ...headers, [n]: insertSecret(v, e.target.value) }); }}>
                <option value="">비밀값 넣기</option>
                {secretNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" className="btn btn--quiet" aria-label={`헤더 ${n} 삭제`} onClick={() => write(without(headers, n))}>삭제</button>
              {rowError && <p className="help" data-tone="error">{rowError}</p>}
            </li>
          );
        })}
      </ul>
      <form className="header-row" aria-label="헤더 추가" onSubmit={add}>
        <label className="visually-hidden" htmlFor="new-header-name">새 헤더 이름</label>
        <input id="new-header-name" className="input" placeholder="헤더 이름" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="visually-hidden" htmlFor="new-header-value">새 헤더 값</label>
        <input id="new-header-value" className="input" placeholder="헤더 값" value={value} onChange={(e) => setValue(e.target.value)} />
        <select className="input" aria-label="새 헤더에 비밀값 넣기" value=""
                onChange={(e) => { if (e.target.value) setValue((v) => insertSecret(v, e.target.value)); }}>
          <option value="">비밀값 넣기</option>
          {secretNames.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="btn" disabled={!name || !!nameProblem || !!valueProblem}>헤더 추가</button>
        {name && (nameProblem ?? valueProblem) && <p className="help" data-tone="error">{nameProblem ?? valueProblem}</p>}
      </form>
    </fieldset>
  );
}

function SkillTest({ id }: { id: string }) {
  const draft = useDraft();
  const queryClient = useQueryClient();
  const [params, setParams] = useState<{ key: string; value: string }[]>([]);
  const [utterance, setUtterance] = useState("");
  const run = useMutation({
    mutationFn: () => testSkill(draft.botId, id, Object.fromEntries(params.filter((p) => p.key).map((p) => [p.key, p.value])), utterance),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["skillErrors", draft.botId] }),
  });
  return (
    <fieldset className="group">
      <legend>테스트 실행</legend>
      <ul className="header-rows">
        {params.map((p, i) => (
          <li className="header-row" key={i}>
            <label className="visually-hidden" htmlFor={`test-param-${i}-key`}>파라미터 {i + 1} 이름</label>
            <input id={`test-param-${i}-key`} className="input" placeholder="파라미터 이름" value={p.key}
                   onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <label className="visually-hidden" htmlFor={`test-param-${i}-value`}>파라미터 {i + 1} 값</label>
            <input id={`test-param-${i}-value`} className="input" placeholder="값" value={p.value}
                   onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="btn btn--quiet" aria-label={`파라미터 ${i + 1} 삭제`}
                    onClick={() => setParams(params.filter((_, j) => j !== i))}>삭제</button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--quiet" onClick={() => setParams([...params, { key: "", value: "" }])}>파라미터 추가</button>
      <div className="field">
        <label htmlFor="test-utterance">사용자 발화 (선택)</label>
        <input id="test-utterance" className="input" value={utterance} onChange={(e) => setUtterance(e.target.value)} />
      </div>
      {draft.dirty && <p className="help" data-tone="warn">저장 안 된 변경이 있어요. 테스트 실행은 저장된 스킬로만 돼요.</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--primary" disabled={draft.dirty || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "테스트 중…" : "테스트 실행"}
        </button>
      </div>
      <div role="status">
        {run.isError && <ErrorNotice error={run.error} onRetry={() => run.mutate()} />}
        {run.data && <TestResult result={run.data} />}
      </div>
    </fieldset>
  );
}

function TestResult({ result }: { result: SkillTestOut }) {
  return (
    <div className="test-result">
      <p className="status" data-tone={result.ok ? "ok" : undefined}>{result.ok ? "성공" : "실패"} · {result.status ?? "—"} · {result.ms}ms</p>
      {result.ok
        ? <pre>{JSON.stringify(result.result, null, 2)}</pre>
        : result.error && (
          <p className="notice" data-tone="error">
            {skillErrorMessage(result.error.kind, result.error.status)}{result.error.detail ? ` · ${result.error.detail}` : ""}
          </p>
        )}
    </div>
  );
}

function ErrorLog() {
  const draft = useDraft();
  const errors = useQuery({ queryKey: ["skillErrors", draft.botId], queryFn: () => listSkillErrors(draft.botId) });
  const labelOf = (skillId: string) => draft.doc?.skills?.[skillId]?.label || skillId;
  if (errors.isError) return <ErrorNotice error={errors.error} onRetry={() => void errors.refetch()} />;
  if (!errors.data) return <p className="status" role="status">불러오는 중…</p>;
  if (errors.data.length === 0) return <p className="status">아직 오류가 없어요.</p>;
  return (
    <ul className="queue" aria-label="오류 내역">
      {errors.data.map((e, i) => (
        <li className="queue-item" key={i}>
          <p className="queue-text">{labelOf(e.skill)}{e.test && <span className="chip">테스트</span>}</p>
          <p className="queue-meta">
            {when(e.at)} · {skillErrorMessage(e.kind, e.status)} · {e.status ?? "—"} · {e.ms}ms{e.detail ? ` · ${e.detail}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function secretValueError(value: string): string | null {
  if (!value) return "값을 입력해 주세요";
  if (value.length > 4000) return "4000자 이하여야 해요";
  if ([...value].some((c) => c.charCodeAt(0) > 127)) return "ASCII 문자만 쓸 수 있어요";
  if (/[\r\n]/.test(value)) return "줄바꿈은 쓸 수 없어요";
  return null;
}

function Secrets() {
  const draft = useDraft();
  const queryClient = useQueryClient();
  const secrets = useQuery({ queryKey: ["secrets", draft.botId], queryFn: () => listSecrets(draft.botId) });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["secrets", draft.botId] });
  const save = useMutation({
    mutationFn: () => setSecret(draft.botId, name, value),
    onSuccess: () => {
      setNotice(`‘${name}’ 비밀값을 저장했어요.`);
      setName("");
      setValue("");
      refresh();
    },
    onError: (error) => setNotice(error instanceof ApiError && error.status === 422 ? error.message : "저장하지 못했어요. 잠시 후 다시 시도해 주세요."),
  });
  const del = useMutation({
    mutationFn: (n: string) => deleteSecret(draft.botId, n),
    onSuccess: (_, n) => {
      setNotice(`‘${n}’ 비밀값을 지웠어요.`);
      refresh();
    },
    onError: () => setNotice("지우지 못했어요. 잠시 후 다시 시도해 주세요."),
  });
  const nameProblem = name ? (SECRET_NAME_PATTERN.test(name) ? null : "영문자나 밑줄로 시작하고 영문자·숫자·밑줄만 쓸 수 있어요") : null;
  const valueProblem = value ? secretValueError(value) : null;
  const ready = !!name && !nameProblem && !!value && !valueProblem;

  if (secrets.isError) return <ErrorNotice error={secrets.error} onRetry={() => void secrets.refetch()} />;
  return (
    <section aria-label="비밀값">
      <p className="status">헤더 값에서 {"{{ secret.이름 }}"}으로 쓸 수 있어요. 값은 다시 보여 주지 않아요.</p>
      <p className="help" role="status">{notice ?? ""}</p>
      {!secrets.data ? <p className="status" role="status">불러오는 중…</p> : secrets.data.length === 0
        ? <p className="status">아직 비밀값이 없어요.</p>
        : (
          <ul className="queue" aria-label="비밀값 목록">
            {secrets.data.map((s) => (
              <li className="queue-item" key={s.name}>
                <p className="queue-text mono">{s.name}</p>
                <p className="queue-meta">{when(s.updated_at)}</p>
                <div className="form-actions">
                  <button type="button" className="btn btn--quiet" disabled={del.isPending}
                          onClick={() => { if (window.confirm(`‘${s.name}’ 비밀값을 지울까요?`)) del.mutate(s.name); }}>삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      <form className="form" aria-label="비밀값 추가" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <div className="field">
          <label htmlFor="secret-name">이름</label>
          <input id="secret-name" className="input" list="secret-names" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="secret-names">{(secrets.data ?? []).map((s) => <option key={s.name} value={s.name} />)}</datalist>
          <p className="help" data-tone={nameProblem ? "error" : undefined}>{nameProblem ?? ""}</p>
        </div>
        <div className="field">
          <label htmlFor="secret-value">값</label>
          <input id="secret-value" type="password" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
          <p className="help" data-tone={valueProblem ? "error" : undefined}>{valueProblem ?? ""}</p>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={!ready || save.isPending}>비밀값 저장</button>
        </div>
      </form>
    </section>
  );
}
