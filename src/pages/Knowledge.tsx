// 지식베이스 (engine E-D, docs/builder-plan.md §6 B6): FAQ + 문서로 답하는 블록 밖 질문.
// Its own draft and ETag, apart from the bot draft (src/draft/DraftContext) — see src/api/knowledge.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/knowledge.css";
import { ApiError, ConflictError, getJob } from "../api/client";
import { formatDateTime } from "../api/deploy";
import {
  extractFile, type FaqEntry, fileType, getKbDraft, kbBuildError, kbEntries, type KbDocument, type KbDraft, type KbEntry,
  type KbSaved, type KbSearch, type KnowledgeDoc, listKbVersions, parseKbBuildResult, saveKbDraft, searchKb,
  startKbBuild, GENERATION_OUTCOME, llmStatus,
} from "../api/knowledge";
import { ErrorNotice } from "../components/ErrorNotice";
import { Proposals } from "../components/Proposals";
import { useDraft } from "../draft/DraftContext";
import {
  addDocument, addFaq, documentWarning, duplicateFaqIds, emptyKb, faqWarning, firstLine, kbProblem, LIMITS,
  removeDocument, removeFaq, sameKb, SUGGEST_TEXT_DEFAULT, uploadReason, writeDocument, writeFaq, writeSettings,
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

  // kept in the query cache, not in the page: going to another menu and back keeps unsaved edits
  const edit = useQuery({ queryKey: ["kbEdit", botId], queryFn: () => null as KbEdit | null, initialData: null,
                          staleTime: Infinity, gcTime: Infinity }).data;
  const setEdit = useCallback((next: KbEdit | null | ((current: KbEdit | null) => KbEdit | null)) => {
    queryClient.setQueryData<KbEdit | null>(["kbEdit", botId], (current) => (typeof next === "function" ? next(current ?? null) : next));
  }, [queryClient, botId]);
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
  }, [query.isSuccess, storedDoc, storedEtag, setEdit]);

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
  // 412: saved elsewhere since we read it; 428: created elsewhere while we had none
  const conflict = save.error instanceof ConflictError || (save.error instanceof ApiError && save.error.status === 428);
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
              {save.isPending ? "지식베이스 저장 중…" : dirty ? "지식베이스에 저장 안 된 변경이 있어요"
                : lastSave ? `지식베이스를 저장했어요 · 리비전 ${lastSave.revision}` : "지식베이스 변경 없음"}
            </p>
            <span className="spacer" />
            <button type="button" className="btn btn--quiet" onClick={discard} disabled={!dirty || save.isPending}>지식베이스 변경 취소</button>
            <button type="button" className="btn btn--primary" onClick={doSave} disabled={!dirty || save.isPending} aria-busy={save.isPending}>
              {save.isPending ? "저장 중…" : "지식베이스 저장"}
            </button>
          </div>
          {conflict && (
            <div className="notice" data-tone="warn" role="alert">
              <p>다른 곳에서 지식베이스가 바뀌었어요. 다시 불러온 뒤 고쳐 주세요. 다시 불러오면 저장하지 않은 변경은 사라져요.</p>
              <div className="actions"><button type="button" className="btn" onClick={reload}>다시 불러오기</button></div>
            </div>
          )}
          {save.error != null && !conflict && <ErrorNotice error={save.error} onRetry={doSave} />}
          {lastSave && !lastSave.valid && (
            <details className="notice" data-tone="warn" open>
              <summary>{`저장했지만 고칠 곳이 ${lastSave.errors.length}개 있어요`}</summary>
              <ul>{lastSave.errors.map((e, i) => <li key={i}>{kbProblem(e)}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {doc && tab === "faq" && <FaqTab botId={botId} kb={doc} onChange={update}
                                       blocked={dirty || !hasSaved ? "저장하지 않은 바뀐 내용이 있어요. 저장하면 저장된 FAQ로 만들어요." : null} />}
      {doc && tab === "docs" && (
        <DocsTab botId={botId} kb={doc} onChange={update} selectedId={selectedDocId} onSelect={setSelectedDocId} />
      )}
      {query.isSuccess && tab === "search" && <SearchTab botId={botId} />}
      {query.isSuccess && tab === "versions" && <VersionsTab botId={botId} dirty={dirty} hasSaved={hasSaved} />}
    </>
  );
}

// ---------------------------------------------------------------- FAQ

/** 비슷한 질문: other ways to ask an FAQ question (typos, casual wording, synonyms), found like the question. */
function SimilarQuestions({ botId, faq, n, blocked, onChange }: {
  botId: string; faq: FaqEntry; n: number; blocked: string | null; onChange: Change;
}) {
  const similar = faq.similar ?? [];
  const [text, setText] = useState("");
  const set = (next: string[]) => onChange((d) => writeFaq(d, faq.id, { similar: next }));
  const fresh = (t: string) => t.trim() && t.trim() !== faq.question.trim() && !similar.includes(t.trim());
  const add = (texts: string[]) => set([...similar, ...texts.map((t) => t.trim()).filter((t, i, all) => fresh(t) && all.indexOf(t) === i)]
    .slice(0, LIMITS.similar));
  const full = similar.length >= LIMITS.similar;
  return (
    <details className="similar">
      <summary>{`비슷한 질문 ${similar.length}개`}</summary>
      <p className="help">오타·구어체·다른 표현으로 물어도 이 FAQ를 찾아요(최대 {LIMITS.similar}개).</p>
      <ul className="examples" aria-label={`FAQ ${n} 비슷한 질문`}>
        {similar.map((q, i) => (
          <li key={i}>
            <span>{q}</span>
            <button type="button" className="btn btn--quiet" aria-label={`비슷한 질문 "${q}" 삭제`}
                    onClick={() => set(similar.filter((_, j) => j !== i))}>삭제</button>
          </li>
        ))}
      </ul>
      <form className="inline-add" onSubmit={(e) => { e.preventDefault(); if (fresh(text)) add([text]); setText(""); }}>
        <label className="visually-hidden" htmlFor={`faq-${faq.id}-similar`}>{`FAQ ${n} 비슷한 질문 추가`}</label>
        <input id={`faq-${faq.id}-similar`} className="input" value={text} maxLength={LIMITS.question} disabled={full}
               onChange={(e) => setText(e.target.value)} placeholder="비슷한 질문을 입력하고 Enter" />
        <button type="submit" className="btn" disabled={full || !fresh(text)}>추가</button>
      </form>
      {full ? <p className="help" data-tone="warn">비슷한 질문은 {LIMITS.similar}개까지예요.</p>
        : <Proposals botId={botId} kind="faq" target={faq.id} what="비슷한 질문" blocked={blocked} onAdd={add} />}
    </details>
  );
}

function FaqTab({ botId, kb, onChange, blocked }: { botId: string; kb: KnowledgeDoc; onChange: Change; blocked: string | null }) {
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
                <input id={`faq-${f.id}-q`} className="input" value={f.question} maxLength={LIMITS.question}
                       onChange={(e) => onChange((d) => writeFaq(d, f.id, { question: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor={`faq-${f.id}-a`}>{`FAQ ${n} 답`}</label>
                <textarea id={`faq-${f.id}-a`} className="input" value={f.answer} maxLength={LIMITS.answer}
                          onChange={(e) => onChange((d) => writeFaq(d, f.id, { answer: e.target.value }))} />
              </div>
              <SimilarQuestions botId={botId} faq={f} n={n} blocked={blocked} onChange={onChange} />
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

/** 생성형 답변: the engine's LLM writes a short answer from the passage that passed (즉문즉답형 only). */
function GenerateField({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  // asked again when the window regains focus and on 다시 확인: a server that stopped must not stay "연결됨"
  const llm = useQuery({ queryKey: ["llm"], queryFn: llmStatus, staleTime: 60_000, refetchOnWindowFocus: true });
  const status = llm.isPending ? "LLM 연결을 확인하는 중…"
    : llm.isError ? "LLM 연결을 확인하지 못했어요."
    : !llm.data.configured ? "이 엔진에는 LLM이 연결되어 있지 않아요. 켜 두어도 찾은 자료 원문으로 답해요."
    : llm.data.ok ? `연결됨: ${llm.data.model ?? ""} (${llm.data.ms ?? "?"}ms)`
    : `LLM이 답하지 않아요: ${llm.data.error ?? "알 수 없는 오류"}. 그동안은 찾은 자료 원문으로 답해요.`;
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
               aria-describedby="kb-generate-help" />
        생성형 답변 (찾은 자료로 LLM이 짧게 답해요)
      </label>
      <p id="kb-generate-help" className="help">
        {disabled ? "즉문즉답형에서만 쓸 수 있어요. " : ""}
        자료에 없는 숫자가 있거나 모델이 답할 수 없다고 하면 그 답은 버리고 폴백으로 가요. LLM이 제때 답하지 못하면 찾은 자료 원문으로 답해요. {status}
      </p>
      <button type="button" className="btn" disabled={llm.isFetching} onClick={() => void llm.refetch()}>
        {llm.isFetching ? "LLM 연결 확인 중…" : "LLM 연결 다시 확인"}
      </button>
    </div>
  );
}

function SettingsFields({ kb, onChange }: { kb: KnowledgeDoc; onChange: Change }) {
  const settings: { mode: "instant" | "suggest"; suggest_text: string; generate?: boolean } =
    kb.settings ?? { mode: "instant", suggest_text: SUGGEST_TEXT_DEFAULT };
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
      <GenerateField checked={settings.generate === true} disabled={settings.mode !== "instant"}
                     onChange={(on) => onChange((d) => writeSettings(d, { generate: on }))} />
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
    if (file.size > LIMITS.upload) {
      setUploadError(uploadReason("over 10 MB"));
      return;
    }
    setUploading(true);
    try {
      const text = await extractFile(botId, file, type);
      let id = "";
      onChange((d) => { // the draft as it is now: edits made while the file was read stay
        const added = addDocument(d, file.name.slice(0, LIMITS.name), text);
        id = added.id;
        return added.kb;
      });
      onSelect(id);
    } catch (error) {
      setUploadError(error instanceof ApiError ? uploadReason(error.problems[0] ?? error.message) : "파일을 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploading(false);
    }
  };

  const writeEmpty = () => {
    let id = "";
    onChange((d) => {
      const added = addDocument(d, "", "");
      id = added.id;
      return added.kb;
    });
    onSelect(id);
  };

  return (
    <section aria-label="문서">
      <p className="help">## 로 시작하는 줄은 문서를 섹션으로 나눠요. 스캔한 PDF는 글자가 없어서 쓸 수 없어요.</p>
      <div className="split">
        <div className="blocklist">
          <div className="blocklist-tools">
            <input id="kb-file-input" ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown" className="visually-hidden"
                   tabIndex={-1} aria-hidden="true" disabled={uploading}
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
                  {documentWarning(d) && <span className="meta" data-tone="warn">{documentWarning(d)}</span>}
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
          <input id="doc-name" className="input" value={doc.name} maxLength={LIMITS.name}
                 onChange={(e) => onChange((d) => writeDocument(d, doc.id, { name: e.target.value }))} />
        </div>
        <button type="button" className="btn btn--quiet"
                onClick={() => { if (window.confirm(`‘${doc.name || doc.id}’ 문서를 지울까요?`)) onChange((d) => removeDocument(d, doc.id)); }}>
          문서 삭제
        </button>
      </div>
      <div className="field">
        <label htmlFor="doc-text">본문</label>
        <textarea id="doc-text" className="input mono" value={doc.text} maxLength={LIMITS.text}
                  onChange={(e) => onChange((d) => writeDocument(d, doc.id, { text: e.target.value }))} />
        <p className="help">{`${doc.text.length.toLocaleString()}자 · ## 로 시작하는 줄이 섹션 제목이 돼요.`}</p>
        {documentWarning(doc) && <p className="help" data-tone="warn">{documentWarning(doc)}</p>}
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
          <select id="kb-search-version" className="input" value={effectiveVersion}
                  onChange={(e) => { setSelectedVersion(e.target.value); search.reset(); }}>
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
        search.error instanceof ApiError && (search.error.status === 409 || search.error.status === 404)
          ? <p className="notice" data-tone="error" role="alert">{searchRefusal(search.error)}</p>
          : <ErrorNotice error={search.error} onRetry={() => search.mutate()} />
      )}
      {search.data && <SearchResult result={search.data} />}
    </section>
  );
}

function searchRefusal(error: ApiError): string {
  if (error.status === 404) return "그런 버전이 없어요. 목록을 새로 고쳐 주세요.";
  if (/cannot be used here/.test(error.message) || error.problems.length > 0) {
    return `이 버전은 지금 쓸 수 없어요. 색인을 다시 만들어 주세요.${error.problems.length ? ` (${error.problems.join(", ")})` : ""}`;
  }
  return "아직 색인이 없어요. 버전 탭에서 먼저 색인을 만들어 주세요.";
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
      {result.generated && (
        <p className="status">{`생성형 답변: ${result.generated.model} · ${result.generated.ms}ms · ${GENERATION_OUTCOME[result.generated.outcome]}`}</p>
      )}
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

  const jobKey = ["kbBuildJobId", botId]; // in the query cache: switching tabs keeps following the job
  const jobId = useQuery({ queryKey: jobKey, queryFn: () => null as string | null, initialData: null, staleTime: Infinity, gcTime: Infinity }).data;
  const build = useMutation({ mutationFn: () => startKbBuild(botId), onSuccess: (job) => queryClient.setQueryData(jobKey, job.id) });
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
      {buildFail && buildFail.errors.length > 0 && <ul>{buildFail.errors.map((e, i) => <li key={i}>{kbProblem(e)}</li>)}</ul>}
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
