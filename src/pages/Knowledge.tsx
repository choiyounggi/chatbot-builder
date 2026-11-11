// 지식베이스 (engine E-D, docs/builder-plan.md §6 B6): FAQ + 문서로 답하는 블록 밖 질문.
// Its own draft and ETag, apart from the bot draft (src/draft/DraftContext) — see src/api/knowledge.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/knowledge.css";
import { ApiError, ConflictError, getJob } from "../api/client";
import { formatDateTime } from "../api/deploy";
import {
  extractFile, fileType, getKbDraft, kbBuildError, kbEntries, type KbDocument, type KbDraft, type KbEntry,
  type KbSaved, type KbSearch, type KnowledgeDoc, listKbVersions, parseKbBuildResult, saveKbDraft, searchKb,
  startKbBuild,
} from "../api/knowledge";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import {
  addDocument, addFaq, duplicateFaqIds, emptyKb, faqWarning, firstLine, removeDocument, removeFaq, sameKb,
  SUGGEST_TEXT_DEFAULT, writeDocument, writeFaq, writeSettings,
} from "../model/knowledge";

type Tab = "faq" | "docs" | "search" | "versions";
type Change = (change: (kb: KnowledgeDoc) => KnowledgeDoc) => void;

interface KbEdit {
  kb: KnowledgeDoc;
  base: string | null;
}

export function Knowledge() {
  const { botId } = useDraft();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["kbDraft", botId], queryFn: () => getKbDraft(botId) });
  const storedDoc: KnowledgeDoc = query.data ? query.data.document : emptyKb();
  const storedEtag: string | null = query.data ? query.data.etag : null;
  const hasSaved = query.isSuccess && query.data !== null;

  const [edit, setEdit] = useState<KbEdit | null>(null);
  const [lastSave, setLastSave] = useState<KbSaved | null>(null);
  const doc = query.isSuccess ? (edit?.kb ?? storedDoc) : null;
  const dirty = query.isSuccess && edit !== null && !sameKb(edit.kb, storedDoc);

  const update = useCallback<Change>((change) => {
    if (!query.isSuccess) return;
    setEdit((current) => {
      const base = current ?? { kb: storedDoc, base: storedEtag };
      const next = change(structuredClone(base.kb));
      return base.base === storedEtag && sameKb(next, storedDoc) ? null : { kb: next, base: base.base };
    });
  }, [query.isSuccess, storedDoc, storedEtag]);

  const save = useMutation({
    mutationFn: (sent: KbEdit) => saveKbDraft(botId, sent.kb, sent.base),
    onSuccess: ({ saved, etag }, sent) => {
      setLastSave(saved);
      const next: KbDraft | null = etag ? { document: sent.kb, etag } : null;
      queryClient.setQueryData<KbDraft | null>(["kbDraft", botId], next);
      setEdit((current) => (current && !sameKb(current.kb, sent.kb) ? { kb: current.kb, base: etag } : null));
    },
  });
  const doSave = () => { if (edit && !save.isPending) save.mutate(edit); };
  const discard = () => { setEdit(null); save.reset(); };
  const reload = () => { setEdit(null); save.reset(); void query.refetch(); };

  const [tab, setTab] = useState<Tab>("faq");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  return (
    <>
      <header>
        <h1>지식베이스</h1>
        <p>블록에 없는 질문에 FAQ와 문서로 답해요. 저장하고 색인을 만든 뒤, 배포 화면에서 봇 버전과 함께 배포해요.</p>
      </header>

      <div className="tabs" role="group" aria-label="지식베이스 화면">
        <button type="button" className="btn" aria-pressed={tab === "faq"} onClick={() => setTab("faq")}>FAQ</button>
        <button type="button" className="btn" aria-pressed={tab === "docs"} onClick={() => setTab("docs")}>문서</button>
        <button type="button" className="btn" aria-pressed={tab === "search"} onClick={() => setTab("search")}>검색 테스트</button>
        <button type="button" className="btn" aria-pressed={tab === "versions"} onClick={() => setTab("versions")}>버전</button>
      </div>

      {query.isPending && (
        <div className="skeletons" role="status">
          <span className="visually-hidden">지식베이스를 불러오는 중</span>
          <div className="skeleton" /><div className="skeleton" />
        </div>
      )}
      {query.isError && <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />}

      {doc && (tab === "faq" || tab === "docs") && (
        <div className="savebar-wrap">
          <div className="savebar" data-dirty={dirty}>
            <p className="status" role="status">
              {save.isPending ? "저장 중…" : dirty ? "저장 안 된 변경이 있어요"
                : lastSave ? `저장했어요 · 리비전 ${lastSave.revision}` : "변경 없음"}
            </p>
            <span className="spacer" />
            <button type="button" className="btn btn--quiet" onClick={discard} disabled={!dirty || save.isPending}>변경 취소</button>
            <button type="button" className="btn btn--primary" onClick={doSave} disabled={!dirty || save.isPending} aria-busy={save.isPending}>
              {save.isPending ? "저장 중…" : "저장"}
            </button>
          </div>
          {save.error instanceof ConflictError && (
            <div className="notice" data-tone="warn" role="alert">
              <p>다른 곳에서 지식베이스가 바뀌었어요. 다시 불러온 뒤 고쳐 주세요.</p>
              <div className="actions"><button type="button" className="btn" onClick={reload}>다시 불러오기</button></div>
            </div>
          )}
          {save.error != null && !(save.error instanceof ConflictError) && <ErrorNotice error={save.error} onRetry={doSave} />}
          {lastSave && !lastSave.valid && (
            <details className="notice" data-tone="warn" open>
              <summary>{`저장했지만 고칠 곳이 ${lastSave.errors.length}개 있어요`}</summary>
              <ul>{lastSave.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {doc && tab === "faq" && <FaqTab kb={doc} onChange={update} />}
      {doc && tab === "docs" && (
        <DocsTab botId={botId} kb={doc} onChange={update} selectedId={selectedDocId} onSelect={setSelectedDocId} />
      )}
      {query.isSuccess && tab === "search" && <SearchTab botId={botId} />}
      {query.isSuccess && tab === "versions" && <VersionsTab botId={botId} dirty={dirty} hasSaved={hasSaved} />}
    </>
  );
}

// ---------------------------------------------------------------- FAQ

function FaqTab({ kb, onChange }: { kb: KnowledgeDoc; onChange: Change }) {
  const faqs = kb.faq ?? [];
  const duplicates = duplicateFaqIds(kb);
  return (
    <section aria-label="FAQ">
      <SettingsFields kb={kb} onChange={onChange} />
      <p className="status">{`FAQ ${faqs.length}개`}</p>
      {faqs.length === 0 && <div className="empty"><p>아직 FAQ가 없어요. 아래에서 추가해 보세요.</p></div>}
      <ul className="queue" aria-label="FAQ 목록">
        {faqs.map((f, i) => {
          const n = i + 1;
          const warning = faqWarning(f, duplicates);
          return (
            <li key={f.id} className="queue-item">
              <div className="field">
                <label htmlFor={`faq-${f.id}-q`}>{`FAQ ${n} 질문`}</label>
                <input id={`faq-${f.id}-q`} className="input" value={f.question}
                       onChange={(e) => onChange((d) => writeFaq(d, f.id, { question: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor={`faq-${f.id}-a`}>{`FAQ ${n} 답`}</label>
                <textarea id={`faq-${f.id}-a`} className="input" value={f.answer}
                          onChange={(e) => onChange((d) => writeFaq(d, f.id, { answer: e.target.value }))} />
              </div>
              {warning && <p className="help" data-tone="warn">{warning}</p>}
              <div className="form-actions">
                <button type="button" className="btn btn--quiet" onClick={() => onChange((d) => removeFaq(d, f.id))}>삭제</button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn" onClick={() => onChange((d) => addFaq(d).kb)}>FAQ 추가</button>
    </section>
  );
}

function SettingsFields({ kb, onChange }: { kb: KnowledgeDoc; onChange: Change }) {
  const settings = kb.settings ?? { mode: "instant" as const, suggest_text: SUGGEST_TEXT_DEFAULT };
  return (
    <fieldset className="group">
      <legend>응답 방식</legend>
      <label className="check">
        <input type="radio" name="kb-mode" checked={settings.mode === "instant"}
               onChange={() => onChange((d) => writeSettings(d, { mode: "instant" }))} />
        즉문즉답형 (가장 알맞은 답 하나)
      </label>
      <label className="check">
        <input type="radio" name="kb-mode" checked={settings.mode === "suggest"}
               onChange={() => onChange((d) => writeSettings(d, { mode: "suggest" }))} />
        답안 추천형 (알맞은 답 최대 3개를 버튼으로)
      </label>
      {settings.mode === "suggest" && (
        <div className="field">
          <label htmlFor="kb-suggest-text">안내 문구</label>
          <input id="kb-suggest-text" className="input" maxLength={200} value={settings.suggest_text}
                 onChange={(e) => onChange((d) => writeSettings(d, { suggest_text: e.target.value }))} />
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- 문서

function DocsTab({ botId, kb, onChange, selectedId, onSelect }: {
  botId: string; kb: KnowledgeDoc; onChange: Change; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  const docs = kb.documents ?? [];
  const selected = docs.find((d) => d.id === selectedId) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setUploadError(null);
    const type = fileType(file);
    if (!type) {
      setUploadError("PDF, 텍스트(.txt), 마크다운(.md)만 올릴 수 있어요.");
      return;
    }
    setUploading(true);
    try {
      const text = await extractFile(botId, file, type);
      const { kb: next, id } = addDocument(kb, file.name, text);
      onChange(() => next);
      onSelect(id);
    } catch (error) {
      setUploadError(error instanceof ApiError ? (error.problems[0] ?? error.message) : "파일을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploading(false);
    }
  };

  const writeEmpty = () => {
    const { kb: next, id } = addDocument(kb, "", "");
    onChange(() => next);
    onSelect(id);
  };

  return (
    <section aria-label="문서">
      <p className="help">## 로 시작하는 줄은 문서를 섹션으로 나눠요. 스캔한 PDF는 글자가 없어서 쓸 수 없어요.</p>
      <div className="split">
        <div className="blocklist">
          <div className="blocklist-tools">
            <label className="visually-hidden" htmlFor="kb-file-input">파일 올리기</label>
            <input id="kb-file-input" ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown" className="visually-hidden"
                   onChange={(e) => {
                     const file = e.target.files?.[0];
                     e.target.value = "";
                     if (file) void upload(file);
                   }} />
            <button type="button" className="btn" disabled={uploading} aria-busy={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? "읽는 중…" : "파일 올리기"}
            </button>
            <button type="button" className="btn btn--quiet" onClick={writeEmpty}>직접 쓰기</button>
          </div>
          {uploadError && <p className="help" data-tone="error" role="alert">{uploadError}</p>}
          {docs.length === 0 && <div className="empty"><p>아직 문서가 없어요. 파일을 올리거나 직접 써 보세요.</p></div>}
          <ul aria-label="문서 목록">
            {docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="skill-row" aria-current={d.id === selectedId ? "true" : undefined} onClick={() => onSelect(d.id)}>
                  <span className="name">{d.name || "(이름 없음)"}</span>
                  <span className="meta">{`${d.text.length.toLocaleString()}자 · ${firstLine(d.text) || "(내용 없음)"}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected
          ? <DocumentEditor key={selected.id} doc={selected} onChange={onChange} />
          : <section className="editor empty"><p>왼쪽에서 문서를 고르거나 새로 만들어 보세요.</p></section>}
      </div>
    </section>
  );
}

function DocumentEditor({ doc, onChange }: { doc: KbDocument; onChange: Change }) {
  return (
    <section className="editor" aria-label={`문서 ${doc.name || doc.id}`}>
      <div className="editor-head">
        <div className="field">
          <label htmlFor="doc-name">이름</label>
          <input id="doc-name" className="input" value={doc.name}
                 onChange={(e) => onChange((d) => writeDocument(d, doc.id, { name: e.target.value }))} />
        </div>
        <button type="button" className="btn btn--quiet"
                onClick={() => { if (window.confirm(`‘${doc.name || doc.id}’ 문서를 지울까요?`)) onChange((d) => removeDocument(d, doc.id)); }}>
          문서 삭제
        </button>
      </div>
      <div className="field">
        <label htmlFor="doc-text">본문</label>
        <textarea id="doc-text" className="input mono" value={doc.text}
                  onChange={(e) => onChange((d) => writeDocument(d, doc.id, { text: e.target.value }))} />
        <p className="help">{`${doc.text.length.toLocaleString()}자 · ## 로 시작하는 줄이 섹션 제목이 돼요.`}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 검색 테스트

function SearchTab({ botId }: { botId: string }) {
  const versions = useQuery({ queryKey: ["kbVersions", botId], queryFn: () => listKbVersions(botId) });
  const list = versions.data?.versions ?? [];
  const [selectedVersion, setSelectedVersion] = useState("");
  const effectiveVersion = selectedVersion || list[0]?.version || "";
  const [queryText, setQueryText] = useState("");
  const search = useMutation({ mutationFn: () => searchKb(botId, queryText, effectiveVersion) });

  return (
    <section aria-label="검색 테스트">
      {versions.isError && <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} />}
      {versions.isSuccess && list.length === 0 && <div className="empty"><p>아직 색인이 없어요. 버전 탭에서 먼저 색인을 만들어 주세요.</p></div>}
      {list.length > 0 && (
        <div className="field">
          <label htmlFor="kb-search-version">버전</label>
          <select id="kb-search-version" className="input" value={effectiveVersion} onChange={(e) => setSelectedVersion(e.target.value)}>
            {list.map((v) => <option key={v.version} value={v.version}>{`v${v.number}${v.live ? " · 라이브" : ""}`}</option>)}
          </select>
        </div>
      )}
      <form className="inline-add" aria-label="검색 테스트"
            onSubmit={(e) => { e.preventDefault(); if (queryText.trim() && effectiveVersion) search.mutate(); }}>
        <label className="visually-hidden" htmlFor="kb-search-query">검색어</label>
        <input id="kb-search-query" className="input" value={queryText} onChange={(e) => setQueryText(e.target.value)} />
        <button type="submit" className="btn btn--primary" disabled={!queryText.trim() || !effectiveVersion || search.isPending}>검색</button>
      </form>
      {search.isError && (
        search.error instanceof ApiError && search.error.status === 409
          ? <p className="notice" data-tone="error" role="alert">아직 색인이 없어요. 버전 탭에서 먼저 색인을 만들어 주세요.</p>
          : <ErrorNotice error={search.error} onRetry={() => search.mutate()} />
      )}
      {search.data && <SearchResult result={search.data} />}
    </section>
  );
}

function SearchResult({ result }: { result: KbSearch }) {
  return (
    <div className="test-result">
      {result.answer ? (
        <div className="bubble bubble--bot">
          <p>{result.answer.text}</p>
          {result.answer.replies.length > 0 && (
            <div className="form-actions">
              {result.answer.replies.map((r, i) => <button key={i} type="button" className="btn btn--quiet" disabled>{r.label}</button>)}
            </div>
          )}
        </div>
      ) : <p className="status">답하지 않아요 (폴백으로 가요)</p>}
      <p className="status">{`판단: ${result.judge} · 기준 ${result.threshold.toFixed(2)}`}</p>
      <table className="table stack-table">
        <thead>
          <tr><th scope="col">종류</th><th scope="col">제목</th><th scope="col">유사도</th><th scope="col">판단 점수</th><th scope="col">통과</th></tr>
        </thead>
        <tbody>
          {result.candidates.map((c) => (
            <tr key={c.id}>
              <td data-label="종류"><span className="chip">{c.kind === "faq" ? "FAQ" : "문서"}</span></td>
              <td data-label="제목">{c.title}</td>
              <td data-label="유사도" className="mono">{c.cosine.toFixed(3)}</td>
              <td data-label="판단 점수" className="mono">{c.score.toFixed(3)}</td>
              <td data-label="통과">{c.passed ? "✓" : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- 버전

function VersionsTab({ botId, dirty, hasSaved }: { botId: string; dirty: boolean; hasSaved: boolean }) {
  const queryClient = useQueryClient();
  const versions = useQuery({ queryKey: ["kbVersions", botId], queryFn: () => listKbVersions(botId) });
  const list = versions.data?.versions ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const entries = useQuery({
    queryKey: ["kbEntries", botId, selected],
    queryFn: () => kbEntries(botId, selected as string),
    enabled: selected !== null,
  });

  const [jobId, setJobId] = useState<string | null>(null);
  const build = useMutation({ mutationFn: () => startKbBuild(botId), onSuccess: (job) => setJobId(job.id) });
  const job = useQuery({
    queryKey: ["kbBuildJob", jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.status === "error" || (q.state.data && ["done", "failed"].includes(q.state.data.status)) ? false : 400),
  });
  const building = build.isPending || (jobId !== null && !job.isError && (!job.data || job.data.status === "queued" || job.data.status === "running"));
  const buildResult = job.data?.status === "done" ? parseKbBuildResult(job.data.result) : null;
  const buildFail = job.data?.status === "failed" ? kbBuildError(job.data.error) : null;

  const refreshedForJob = useRef<string | null>(null);
  useEffect(() => {
    if (job.data?.status === "done" && refreshedForJob.current !== job.data.id) {
      refreshedForJob.current = job.data.id;
      void queryClient.invalidateQueries({ queryKey: ["kbVersions", botId] });
    }
  }, [job.data, queryClient, botId]);

  const disabledReason = dirty ? "저장 안 된 변경이 있어요. 먼저 저장해 주세요."
    : !hasSaved ? "저장된 지식베이스가 없어요. 먼저 저장해 주세요." : null;
  const selectedVersion = list.find((v) => v.version === selected) ?? null;

  return (
    <section aria-label="버전">
      <div className="form-actions">
        <button type="button" className="btn btn--primary" disabled={!!disabledReason || building} aria-busy={building}
                onClick={() => build.mutate()}>
          {building ? "색인 만드는 중…" : "색인 만들기"}
        </button>
      </div>
      {disabledReason && !building && <p className="help" data-tone="warn">{disabledReason}</p>}
      <p className="status" role="status">
        {building ? "색인을 만들고 있어요…"
          : buildResult ? `v${buildResult.number ?? "?"} 색인 완료 · FAQ ${buildResult.faq ?? 0}개 · 조각 ${buildResult.chunks ?? 0}개`
          : buildFail ? buildFail.message
          : "아직 색인을 만들지 않았어요"}
      </p>
      {buildFail && buildFail.errors.length > 0 && <ul>{buildFail.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {build.isError && <ErrorNotice error={build.error} onRetry={() => build.mutate()} />}
      {job.isError && <ErrorNotice error={job.error} onRetry={() => void job.refetch()} />}

      {versions.isPending && (
        <div className="skeletons" role="status"><span className="visually-hidden">버전을 불러오는 중</span><div className="skeleton" /></div>
      )}
      {versions.isError && <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} />}
      {versions.isSuccess && list.length === 0 && <div className="empty"><p>아직 만든 색인이 없어요.</p></div>}
      {versions.isSuccess && list.length > 0 && (
        <table className="table stack-table">
          <thead><tr><th scope="col">버전</th><th scope="col">만든 시각</th><th scope="col">FAQ</th><th scope="col">조각</th><th scope="col">상태</th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.version}>
                <td data-label="버전">
                  <button type="button" className="btn btn--quiet" aria-pressed={v.version === selected} onClick={() => setSelected(v.version)}>
                    {`v${v.number}`}
                  </button>
                </td>
                <td data-label="만든 시각">{formatDateTime(v.created_at)}</td>
                <td data-label="FAQ" className="mono">{v.faq}</td>
                <td data-label="조각" className="mono">{v.chunks}</td>
                <td data-label="상태">{v.live && <span className="chip" data-tone="live">라이브</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div>
          <h3>{`조각 미리보기${selectedVersion ? ` · v${selectedVersion.number}` : ""}`}</h3>
          {entries.isError && <ErrorNotice error={entries.error} onRetry={() => void entries.refetch()} />}
          {entries.isPending && <p className="status" role="status">불러오는 중…</p>}
          {entries.data && <EntriesPreview entries={entries.data} />}
        </div>
      )}
    </section>
  );
}

function EntriesPreview({ entries }: { entries: KbEntry[] }) {
  const CLAMP = 200;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <ul className="queue" aria-label="조각 미리보기">
      {entries.map((e) => {
        const long = e.body.length > CLAMP;
        const open = expanded.has(e.id);
        return (
          <li key={e.id} className="queue-item">
            <p className="queue-meta"><span className="chip">{e.kind === "faq" ? "FAQ" : "문서"}</span> {e.title}</p>
            <p className="queue-text">{long && !open ? `${e.body.slice(0, CLAMP)}…` : e.body}</p>
            {long && <button type="button" className="btn btn--quiet" onClick={() => toggle(e.id)}>{open ? "접기" : "더 보기"}</button>}
            {e.source && <p className="queue-meta">{`출처: ${e.source}`}</p>}
          </li>
        );
      })}
    </ul>
  );
}
