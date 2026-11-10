import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ErrorNotice } from "../components/ErrorNotice";
import { useDraft } from "../draft/DraftContext";
import {
  addParam, addReply, type Block, callersOf, createBlock, deleteBlock, kindOf, listBlocks, looseIntents, newBlockId,
  paramUses, readBlock, removeParam, removeReply, type Reply, writeBlock,
} from "../model/blocks";
import { type BotDoc, type Step, SYSTEM_ENTITIES } from "../model/doc";

const KIND_LABEL = { trigger: "발화로 시작", called: "다른 블록에서 호출" } as const;

/** Absolute: a relative link would resolve differently from /scenarios and /scenarios/<block>. */
const blockPath = (botId: string, block?: string) =>
  `/bots/${encodeURIComponent(botId)}/scenarios${block ? `/${encodeURIComponent(block)}` : ""}`;

export function Scenarios() {
  const draft = useDraft();
  const { blockId } = useParams();
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const { state } = useLocation();
  useEffect(() => {
    if ((state as { focus?: string } | null)?.focus === "search") search.current?.focus(); // a block was just deleted
  }, [state]);
  const doc = draft.doc;
  const blocks = useMemo(() => (doc ? listBlocks(doc) : []), [doc]);

  if (!doc) {
    return draft.query.isError
      ? <ErrorNotice error={draft.query.error} onRetry={() => void draft.query.refetch()} />
      : <div className="skeletons" role="status"><span className="visually-hidden">초안을 불러오는 중</span><div className="skeleton" /><div className="skeleton" /></div>;
  }
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? blocks.filter((b) => [b.id, b.label, ...b.examples].some((t) => t.toLowerCase().includes(needle)))
    : blocks;
  const selected = blockId && doc.scenarios[blockId] ? blockId : null;

  return (
    <>
      <header>
        <h1>시나리오</h1>
        <p>블록마다 사용자가 할 법한 말(발화)과 봇의 응답을 정해요. 저장하면 테스트 빌드가 만들어져 봇테스트에서 바로 확인할 수 있어요.</p>
      </header>
      <div className="split">
        <section className="blocklist" aria-label="블록 목록">
          <div className="blocklist-tools">
            <input ref={search} className="input" type="search" placeholder="블록·발화 검색" aria-label="블록 검색" value={filter}
                   onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="btn" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>새 블록</button>
          </div>
          {creating && <NewBlockForm onDone={() => setCreating(false)} />}
          <ul>
            {shown.map((b) => (
              <li key={b.id}>
                <Link to={blockPath(draft.botId, b.id)} aria-current={b.id === selected ? "page" : undefined}>
                  <span className="name">{b.label || b.id}</span>
                  <span className="meta">{KIND_LABEL[kindOf(b)]}{b.intent ? ` · 발화 ${b.examples.length}` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="status">{needle ? "찾는 블록이 없어요." : "아직 블록이 없어요. 새 블록을 만들어 보세요."}</p>}
          <LooseIntents doc={doc} />
        </section>
        {selected ? <BlockEditor key={selected} id={selected} /> : (
          <section className="editor empty"><p>왼쪽에서 블록을 고르거나 새 블록을 만드세요.</p></section>
        )}
      </div>
    </>
  );
}

function LooseIntents({ doc }: { doc: BotDoc }) {
  const loose = looseIntents(doc);
  if (loose.length === 0) return null;
  return (
    <div className="loose">
      <h2>블록 없는 발화</h2>
      <p className="status">어떤 블록도 시작하지 않지만 학습에는 쓰여요. <code>out_of_scope</code>는 "모르는 질문" 예시예요.</p>
      <ul>{loose.map((id) => <li key={id}><code>{id}</code> · {doc.intents?.[id]?.examples.length ?? 0}개</li>)}</ul>
    </div>
  );
}

function NewBlockForm({ onDone }: { onDone: () => void }) {
  const draft = useDraft();
  const navigate = useNavigate();
  const [label, setLabel] = useState("");
  const [example, setExample] = useState("");
  const [reply, setReply] = useState("");
  const ready = label.trim() && example.trim() && reply.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !draft.doc) return;
    const id = newBlockId(draft.doc); // computed on what is shown; the update below applies to the latest copy
    draft.update((d) => createBlock(d, { label, example, reply }, id).doc);
    onDone();
    void navigate(blockPath(draft.botId, id), { state: { focus: "label" } });
  };
  return (
    <form className="newblock" onSubmit={submit} aria-label="새 블록">
      <div className="field"><label htmlFor="nb-label">블록 이름</label>
        <input id="nb-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="쿠폰 안내" /></div>
      <div className="field"><label htmlFor="nb-example">사용자 발화</label>
        <input id="nb-example" className="input" value={example} onChange={(e) => setExample(e.target.value)} placeholder="쿠폰 어디서 받아요" /></div>
      <div className="field"><label htmlFor="nb-reply">봇 응답</label>
        <input id="nb-reply" className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="쿠폰함에서 받을 수 있어요" /></div>
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={!ready}>블록 만들기</button>
        <button type="button" className="btn btn--quiet" onClick={onDone}>취소</button>
      </div>
    </form>
  );
}

function BlockEditor({ id }: { id: string }) {
  const draft = useDraft();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const doc = draft.doc as BotDoc;
  const block = readBlock(doc, id);
  const change = (next: (b: Block, d: BotDoc) => Block) => draft.update((d) => (d.scenarios[id] ? writeBlock(d, next(readBlock(d, id), d)) : d));
  const entities = [...Object.keys(doc.entities ?? {}), ...SYSTEM_ENTITIES.map((e) => e.id)];
  const label = useRef<HTMLInputElement>(null);
  const { state } = useLocation();
  useEffect(() => {
    if ((state as { focus?: string } | null)?.focus === "label") label.current?.focus(); // just created
  }, [state]);

  const remove = () => {
    const callers = callersOf(doc, id);
    if (callers.length > 0) {
      setProblem(`다른 블록이 이 블록을 부르고 있어요: ${callers.join(", ")}. 그 블록에서 먼저 빼 주세요.`);
      return;
    }
    draft.update((d) => (callersOf(d, id).length > 0 ? d : deleteBlock(d, id)));
    void navigate(blockPath(draft.botId), { state: { focus: "search" } });
  };
  const dropParam = (name: string) => {
    const uses = paramUses(doc, block, name);
    if (uses.length > 0) {
      setProblem(`파라미터 ${name}를 아직 쓰고 있어요: ${uses.join(", ")}. 그 문구나 스킬에서 먼저 빼 주세요.`);
      return;
    }
    setProblem(null);
    change((b) => removeParam(b, name));
  };

  return (
    <section className="editor" aria-label={`블록 ${block.label || block.id}`}>
      <div className="editor-head">
        <div className="field">
          <label htmlFor="block-label">블록 이름</label>
          <input id="block-label" ref={label} className="input" value={block.label} onChange={(e) => change((b) => ({ ...b, label: e.target.value }))} />
        </div>
        <span className="chip">{KIND_LABEL[kindOf(block)]}</span>
        <span className="mono status">{block.id}</span>
        <button type="button" className="btn btn--quiet" onClick={remove}>블록 삭제</button>
      </div>
      {problem && <p className="notice" data-tone="warn" role="alert">{problem}</p>}

      {block.intent && <Examples block={block} onChange={(examples) => change((b) => ({ ...b, examples }))} />}

      <fieldset className="group">
        <legend>파라미터</legend>
        <p className="status">값이 없으면 봇이 되묻는 정보예요. 블록이 응답하기 전에 차례로 받아요.</p>
        {block.params.map((p) => (
          <div className="param" key={p.name}>
            <span className="mono">{p.name}</span>
            <label className="visually-hidden" htmlFor={`entity-${p.name}`}>{p.name} 엔티티</label>
            <select id={`entity-${p.name}`} className="input" value={p.entity}
                    onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name ? { ...x, entity: e.target.value } : x) }))}>
              {(entities.includes(p.entity) ? entities : [p.entity, ...entities]).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <label className="visually-hidden" htmlFor={`ask-${p.name}`}>{p.name} 되묻기 질문</label>
            <input id={`ask-${p.name}`} className="input" placeholder="되묻기 질문 (예: 어느 지역이요?)" value={p.ask.texts[0] ?? ""}
                   onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name
                     ? { ...x, ask: { ...x.ask, texts: [e.target.value, ...x.ask.texts.slice(1)] } } : x) }))} />
            <button type="button" className="btn btn--quiet" onClick={() => dropParam(p.name)}
                    aria-label={`파라미터 ${p.name} 삭제`}>삭제</button>
          </div>
        ))}
        <button type="button" className="btn" disabled={entities.length === 0}
                onClick={() => change((b, d) => addParam(d, b, entities[0] ?? "sys.number"))}>파라미터 추가</button>
      </fieldset>

      <fieldset className="group">
        <legend>봇 응답</legend>
        {block.replies.map((reply, index) => (
          <ReplyEditor key={index} reply={reply} index={index}
                       onChange={(next) => change((b) => ({ ...b, replies: b.replies.map((r, i) => (i === index ? next : r)) }))}
                       onRemove={() => change((b) => removeReply(b, index))} />
        ))}
        <button type="button" className="btn" onClick={() => change((b, d) => addReply(d, b))}>응답 추가</button>
      </fieldset>

      <details className="group">
        <summary>실행 순서 (고급)</summary>
        <ol className="steps">{block.steps.map((step, i) => <li key={i}>{describe(step)}</li>)}</ol>
      </details>
    </section>
  );
}

function Examples({ block, onChange }: { block: Block; onChange: (examples: string[]) => void }) {
  const [text, setText] = useState("");
  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (!block.examples.includes(value)) onChange([...block.examples, value]);
    setText("");
  };
  const few = block.examples.length < 5;
  return (
    <fieldset className="group">
      <legend>사용자 발화 <span className="status">({block.examples.length}개)</span></legend>
      <form className="inline-add" onSubmit={add}>
        <label className="visually-hidden" htmlFor="new-example">새 발화</label>
        <input id="new-example" className="input" value={text} onChange={(e) => setText(e.target.value)}
               placeholder="사용자가 할 법한 말을 입력하고 Enter" />
        <button type="submit" className="btn" disabled={!text.trim()}>추가</button>
      </form>
      {few && <p className="help" data-tone="warn">발화가 5개보다 적으면 테스트는 되지만 배포용 학습은 할 수 없어요. 10개 이상을 권해요.</p>}
      <ul className="examples">
        {block.examples.map((ex, i) => (
          <li key={i}>
            <span>{ex}</span>
            <button type="button" className="btn btn--quiet" aria-label={`발화 "${ex}" 삭제`}
                    onClick={() => onChange(block.examples.filter((_, j) => j !== i))}>삭제</button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ReplyEditor({ reply, index, onChange, onRemove }: { reply: Reply; index: number; onChange: (r: Reply) => void; onRemove: () => void }) {
  const random = reply.texts.length > 1;
  const n = index + 1;
  return (
    <div className="reply">
      <div className="reply-head">
        <span className="status">응답 {n}{random ? " · 랜덤" : ""}</span>
        <span className="mono status">{reply.response}</span>
        <button type="button" className="btn btn--quiet" onClick={onRemove} aria-label={`응답 ${n} 삭제`}>삭제</button>
      </div>
      {reply.sharedWith ? (
        <p className="status">{reply.sharedWith}와 같은 응답이에요. 그곳에서 고치면 여기도 바뀌어요.</p>
      ) : (
        <>
          {reply.missing && <p className="help" data-tone="warn">초안에 이 응답({reply.response})이 없어요. 문구를 쓰면 새로 만들어져요.</p>}
          {(reply.texts.length ? reply.texts : [""]).map((text, i) => (
            <div className="reply-text" key={i}>
              <label className="visually-hidden" htmlFor={`reply-${index}-${i}`}>응답 {n} 문구 {i + 1}</label>
              <textarea id={`reply-${index}-${i}`} className="input" rows={2} value={text}
                        onChange={(e) => onChange({ ...reply, texts: (reply.texts.length ? reply.texts : [""]).map((t, j) => (j === i ? e.target.value : t)) })} />
              {random && (
                <button type="button" className="btn btn--quiet" aria-label={`응답 ${n} 문구 ${i + 1} 삭제`}
                        onClick={() => onChange({ ...reply, texts: reply.texts.filter((_, j) => j !== i) })}>삭제</button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn--quiet" onClick={() => onChange({ ...reply, texts: [...(reply.texts.length ? reply.texts : [""]), ""] })}>
            랜덤 문구 추가
          </button>
          <QuickReplies id={`qr-${index}`} label={`응답 ${n} 바로연결 버튼`} value={reply.quickReplies}
                        onChange={(quickReplies) => onChange({ ...reply, quickReplies })} />
        </>
      )}
    </div>
  );
}

export const parseList = (text: string) => text.split(",").map((q) => q.trim()).filter(Boolean);

/** A comma-separated list edited as text: the text is kept while typing ("서울, " stays). */
function QuickReplies({ id, label, value, onChange }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  const [last, setLast] = useState(value);
  if (last.join("\u0000") !== value.join("\u0000") && parseList(text).join("\u0000") !== value.join("\u0000")) {
    setLast(value); // changed from outside (undo, reload): show it
    setText(value.join(", "));
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={text} placeholder="서울, 부산, 제주"
             onChange={(e) => { setText(e.target.value); setLast(parseList(e.target.value)); onChange(parseList(e.target.value)); }} />
      <p className="help">쉼표로 구분해요(버튼 이름에는 쉼표를 쓸 수 없어요). 누르면 그 글자를 보낸 것처럼 동작해요. 버튼 하나는 40자까지예요.</p>
    </div>
  );
}

function describe(step: Step): string {
  if ("collect" in step) return `파라미터 받기: ${step.collect}`;
  if ("respond" in step) return `응답: ${step.respond}`;
  if ("action" in step) return `스킬 실행: ${step.action}`;
  if ("call" in step) return `블록 호출: ${step.call}`;
  return `분기: ${step.branch.on} → ${Object.entries(step.branch.cases).map(([k, v]) => `${k}:${v}`).join(", ")}`;
}
