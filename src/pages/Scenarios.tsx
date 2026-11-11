import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ErrorNotice } from "../components/ErrorNotice";
import { type BlockOption, ReplyEditor } from "../components/ReplyEditor";
import { useDraft } from "../draft/DraftContext";
import {
  addParam, addReply, type Block, callersOf, createBlock, deleteBlock, kindOf, listBlocks, looseIntents, newBlockId,
  addSkillStep, paramUses, readBlock, removeParam, removeReply, removeSkillStep, resultUses, skillSteps, systemScenarios, textReply,
  updateSkillStep, writeBlock,
} from "../model/blocks";
import { type BotDoc, KAKAO, type Step, SYSTEM_ENTITIES } from "../model/doc";
import { BUILTIN_ACTIONS } from "../model/skills";
import { isSystemPage, SYSTEM_PAGES, SystemEditor } from "./SystemBlocks";

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
  const options: BlockOption[] = useMemo(() => blocks.map((b) => ({ id: b.id, label: b.label })), [blocks]);

  if (!doc) {
    return draft.query.isError
      ? <ErrorNotice error={draft.query.error} onRetry={() => void draft.query.refetch()} />
      : <div className="skeletons" role="status"><span className="visually-hidden">초안을 불러오는 중</span><div className="skeleton" /><div className="skeleton" /></div>;
  }
  const needle = filter.trim().toLowerCase();
  const system = systemScenarios(doc);
  const shown = blocks.filter((b) => !system.has(b.id)
    && (!needle || [b.id, b.label, b.group, ...b.examples].some((t) => t.toLowerCase().includes(needle))));
  const groups = [...new Set(shown.map((b) => b.group))].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "ko")));
  const page = isSystemPage(blockId) ? blockId : null;
  const selected = !page && blockId && doc.scenarios[blockId] ? blockId : null;

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
          <h2 className="list-group">기본 시나리오</h2>
          <ul aria-label="기본 시나리오">
            {SYSTEM_PAGES.map((p) => (
              <li key={p.id}>
                <Link to={blockPath(draft.botId, p.id)} aria-current={p.id === page ? "page" : undefined}>
                  <span className="name">{p.label}</span>
                  <span className="meta">{p.meta}</span>
                </Link>
              </li>
            ))}
          </ul>
          {groups.map((group) => (
            <div key={group || "-"}>
              {(group || groups.length > 1) && <h2 className="list-group">{group || "묶음 없음"}</h2>}
              <ul aria-label={group ? `블록 묶음 ${group}` : "블록"}>
                {shown.filter((b) => b.group === group).map((b) => (
                  <li key={b.id}>
                    <Link to={blockPath(draft.botId, b.id)} aria-current={b.id === selected ? "page" : undefined}>
                      <span className="name">{b.label || b.id}</span>
                      <span className="meta">{KIND_LABEL[kindOf(b)]}{b.intent ? ` · 발화 ${b.examples.length}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {shown.length === 0 && <p className="status">{needle ? "찾는 블록이 없어요." : "아직 블록이 없어요. 새 블록을 만들어 보세요."}</p>}
          <LooseIntents doc={doc} />
        </section>
        {page ? (
          <SystemEditor key={page} page={page} blocks={options}
                        renderBlock={(id) => <BlockEditor key={id} id={id} blocks={options} embedded />} />
        ) : selected ? <BlockEditor key={selected} id={selected} blocks={options} /> : (
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

function BlockEditor({ id, blocks, embedded = false }: { id: string; blocks: BlockOption[]; embedded?: boolean }) {
  const draft = useDraft();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const doc = draft.doc as BotDoc;
  const block = readBlock(doc, id);
  const d = () => draft.doc as BotDoc;
  const change = (next: (b: Block, d: BotDoc) => Block) => draft.update((d) => (d.scenarios[id] ? writeBlock(d, next(readBlock(d, id), d)) : d));
  const entities = [...Object.keys(doc.entities ?? {}), ...SYSTEM_ENTITIES.map((e) => e.id)];
  const label = useRef<HTMLInputElement>(null);
  const { state } = useLocation();
  useEffect(() => {
    if ((state as { focus?: string } | null)?.focus === "label") label.current?.focus(); // just created
  }, [state]);

  const groups = [...new Set(Object.values(doc.scenarios).map((s) => s.group).filter((g): g is string => !!g))];
  const skillIds = Object.keys(doc.skills ?? {});
  const actionIds = [...skillIds, ...BUILTIN_ACTIONS.filter((a) => !skillIds.includes(a))];
  const skillLabel = (sid: string) => (doc.skills?.[sid] ? doc.skills[sid].label || sid
    : (BUILTIN_ACTIONS as readonly string[]).includes(sid) ? `${sid} (내장 액션)` : `${sid} (없는 스킬)`);
  /** Switching or removing an action is refused while a reply or branch still reads its results. */
  const guardResults = (action: string, then: () => void) => {
    const uses = resultUses(doc, block, action);
    if (uses.length > 0) {
      setProblem(`${skillLabel(action).replace(/ \(.*\)$/, "")}의 결과를 아직 쓰고 있어요: ${uses.join(", ")}. 그 문구나 분기에서 먼저 빼 주세요.`);
      return;
    }
    setProblem(null);
    then();
  };
  const remove = () => {
    const callers = callersOf(doc, id);
    if (callers.length > 0) {
      setProblem(`이 블록을 쓰는 곳이 있어요: ${callers.join(", ")}. 그곳에서 먼저 빼 주세요.`);
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
        {!embedded && <button type="button" className="btn btn--quiet" onClick={remove}>블록 삭제</button>}
      </div>
      {!embedded && (
        <div className="field">
          <label htmlFor="block-group">블록 묶음</label>
          <input id="block-group" className="input" list="block-groups" value={block.group} placeholder="묶음 없음"
                 onChange={(e) => change((b) => ({ ...b, group: e.target.value }))} />
          <datalist id="block-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </div>
      )}
      {problem && <p className="notice" data-tone="warn" role="alert">{problem}</p>}

      {block.intent && <Examples block={block} onChange={(examples) => change((b) => ({ ...b, examples }))} />}

      <fieldset className="group">
        <legend>파라미터</legend>
        <p className="status">블록이 응답하기 전에 차례로 받는 정보예요. 필수면 값이 없을 때 되묻고, 필수가 아니면 말에 있을 때만 받아요(없으면 기본값).</p>
        {block.params.map((p) => (
          <div className="param" key={p.name}>
            <span className="mono">{p.name}</span>
            <label className="visually-hidden" htmlFor={`entity-${p.name}`}>{p.name} 엔티티</label>
            <select id={`entity-${p.name}`} className="input" value={p.entity}
                    onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name ? { ...x, entity: e.target.value } : x) }))}>
              {(entities.includes(p.entity) ? entities : [p.entity, ...entities]).map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <label className="check">
              <input type="checkbox" checked={p.required} aria-label={`${p.name} 필수`}
                     onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name
                       ? { ...x, required: e.target.checked, default: e.target.checked ? null : x.default,
                           // a required parameter needs a question; an optional one keeps it only if it says something
                           ask: e.target.checked ? x.ask ?? textReply(newAsk(d(), b, x.name))
                             : x.ask && x.ask.texts.some((t) => t.trim()) ? x.ask : null } : x) }))} /> 필수
            </label>
            {p.required ? (
              <>
                <label className="visually-hidden" htmlFor={`ask-${p.name}`}>{p.name} 되묻기 질문</label>
                <input id={`ask-${p.name}`} className="input" placeholder="되묻기 질문 (예: 어느 지역이요?)" value={p.ask?.texts[0] ?? ""}
                       onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name && x.ask
                         ? { ...x, ask: { ...x.ask, texts: [e.target.value, ...x.ask.texts.slice(1)] } } : x) }))} />
              </>
            ) : (
              <>
                <label className="visually-hidden" htmlFor={`default-${p.name}`}>{p.name} 기본값</label>
                <input id={`default-${p.name}`} className="input" placeholder="기본값 (비우면 값 없이 진행)" value={String(p.default ?? "")}
                       onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name ? { ...x, default: e.target.value } : x) }))} />
              </>
            )}
            <button type="button" className="btn btn--quiet" onClick={() => dropParam(p.name)}
                    aria-label={`파라미터 ${p.name} 삭제`}>삭제</button>
            {(skillIds.length > 0 || p.validation) && (
              <div className="param-check">
                <label htmlFor={`check-${p.name}`}>{p.name} 값 검증</label>
                <select id={`check-${p.name}`} className="input" value={p.validation?.action ?? ""}
                        onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name !== p.name ? x : {
                          ...x, validation: e.target.value ? { action: e.target.value,
                            fail: x.validation?.fail ?? textReply(newFail(d(), b, x.name), "올바른 값이 아니에요. 다시 알려 주세요.") } : null }) }))}>
                  <option value="">검증 안 함</option>
                  {withCurrent(skillIds, p.validation?.action).map((sid) => <option key={sid} value={sid}>{skillLabel(sid)}</option>)}
                </select>
                {p.validation && !p.validation.fail.sharedWith && (
                  <>
                    <label htmlFor={`fail-${p.name}`}>{p.name} 검증 실패 안내</label>
                    <input id={`fail-${p.name}`} className="input" value={p.validation.fail.texts[0] ?? ""}
                           onChange={(e) => change((b) => ({ ...b, params: b.params.map((x) => x.name === p.name && x.validation
                             ? { ...x, validation: { ...x.validation, fail: { ...x.validation.fail, texts: [e.target.value] } } } : x) }))} />
                  </>
                )}
                {p.validation && <p className="help">스킬이 {"{"}"valid": true{"}"}를 돌려주면 받고, 아니면 안내를 말한 뒤 다시 물어요.</p>}
              </div>
            )}
          </div>
        ))}
        <button type="button" className="btn" disabled={entities.length === 0}
                onClick={() => change((b, d) => addParam(d, b, entities[0] ?? "sys.number"))}>파라미터 추가</button>
      </fieldset>

      <fieldset className="group">
        <legend>스킬</legend>
        <p className="status">파라미터를 받은 뒤, 응답하기 전에 부르는 스킬이에요. 응답 문구에서 {"{{ results.스킬.필드 }}"}로 결과를 써요.</p>
        {skillSteps(block).map((step, n) => (
          <div className="skill-step" key={step.index}>
            <div className="field">
              <label htmlFor={`skill-${n}`}>스킬 {n + 1}</label>
              <select id={`skill-${n}`} className="input" value={step.action}
                      onChange={(e) => { const next = e.target.value; guardResults(step.action, () => change((b) => updateSkillStep(b, step.index, next, step.args))); }}>
                {withCurrent(actionIds, step.action).map((sid) => <option key={sid} value={sid}>{skillLabel(sid)}</option>)}
              </select>
            </div>
            <SkillArgs id={`skill-${n}-args`} name={`스킬 ${n + 1}`} args={step.args}
                       onChange={(args) => change((b) => updateSkillStep(b, step.index, step.action, args))} />
            <button type="button" className="btn btn--quiet" aria-label={`스킬 ${n + 1} 빼기`}
                    onClick={() => guardResults(step.action, () => change((b) => removeSkillStep(b, step.index)))}>빼기</button>
          </div>
        ))}
        {skillIds.length === 0 && <p className="help">아직 스킬이 없어요. 스킬 메뉴에서 먼저 만들어 주세요.</p>}
        <button type="button" className="btn" onClick={() => change((b) => addSkillStep(b, actionIds[0] as string))}>스킬 추가</button>
      </fieldset>

      <fieldset className="group">
        <legend>봇 응답</legend>
        {block.replies.map((reply, index) => (
          <ReplyEditor key={index} reply={reply} index={index} blocks={blocks}
                       onChange={(next) => change((b) => ({ ...b, replies: b.replies.map((r, i) => (i === index ? next : r)) }))}
                       onRemove={() => change((b) => removeReply(b, index))} />
        ))}
        <button type="button" className="btn" onClick={() => change((b, d) => addReply(d, b))}>응답 추가</button>
        {block.replies.length > KAKAO.bubbles && (
          <p className="help" data-tone="warn">카카오 채널은 한 블록에서 말풍선을 {KAKAO.bubbles}개까지만 보여 줘요.</p>
        )}
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

export const parseList = (text: string) => text.split(",").map((q) => q.trim()).filter(Boolean);

function describe(step: Step): string {
  if ("collect" in step) return `파라미터 받기: ${step.collect}`;
  if ("respond" in step) return `응답: ${step.respond}`;
  if ("action" in step) return `스킬 실행: ${step.action}`;
  if ("call" in step) return `블록 호출: ${step.call}`;
  return `분기: ${step.branch.on} → ${Object.entries(step.branch.cases).map(([k, v]) => `${k}:${v}`).join(", ")}`;
}

/** A response id for a parameter's question that the document and the block do not use yet. */
function newAsk(doc: BotDoc, block: Block, param: string): string {
  const taken = new Set([...Object.keys(doc.responses), ...block.params.flatMap((p) => (p.ask ? [p.ask.response] : []))]);
  let id = `${block.id}_ask_${param}`;
  for (let n = 2; taken.has(id); n++) id = `${block.id}_ask_${param}_${n}`;
  return id;
}

/** A response id for a parameter's validation message that nothing uses yet. */
function newFail(doc: BotDoc, block: Block, param: string): string {
  const taken = new Set(Object.keys(doc.responses));
  let id = `${block.id}_${param}_invalid`;
  for (let n = 2; taken.has(id); n++) id = `${block.id}_${param}_invalid_${n}`;
  return id;
}

/** The options, plus the current value when it is not one of them (e.g. a built-in action). */
const withCurrent = (options: string[], current: string | undefined) =>
  current && !options.includes(current) ? [current, ...options] : options;

/** A skill's arguments as name/value rows; values may hold {{ slots.x }}. The rows are kept here so a
 * name being typed that collides with another row (or is empty) never merges or reorders rows; only
 * rows with distinct, non-empty names reach the draft. */
function SkillArgs({ id, name, args, onChange }: { id: string; name: string; args: Record<string, string>; onChange: (a: Record<string, string>) => void }) {
  const [rows, setRows] = useState(() => Object.entries(args).map(([key, value]) => ({ key, value })));
  const [seen, setSeen] = useState(args);
  if (JSON.stringify(seen) !== JSON.stringify(args)) { // changed outside (another tab of the editor, undo, reload)
    setSeen(args);
    if (JSON.stringify(toArgs(rows)) !== JSON.stringify(args)) setRows(Object.entries(args).map(([key, value]) => ({ key, value })));
  }
  const update = (next: { key: string; value: string }[]) => {
    setRows(next);
    const out = toArgs(next);
    setSeen(out);
    onChange(out);
  };
  const duplicate = (i: number) => rows.some((r, j) => j < i && r.key === rows[i]?.key); // the earlier row keeps the name
  return (
    <div className="skill-args">
      {rows.map((row, i) => (
        <div className="skill-arg" key={i}>
          <label className="visually-hidden" htmlFor={`${id}-${i}-key`}>{name} 인자 {i + 1} 이름</label>
          <input id={`${id}-${i}-key`} className="input mono" value={row.key} placeholder="이름" aria-invalid={duplicate(i) || !row.key}
                 onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
          <label className="visually-hidden" htmlFor={`${id}-${i}-value`}>{name} 인자 {i + 1} 값</label>
          <input id={`${id}-${i}-value`} className="input" value={row.value} placeholder="값 (예: {{ slots.location }})"
                 onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
          <button type="button" className="btn btn--quiet" aria-label={`${name} 인자 ${i + 1} 삭제`}
                  onClick={() => update(rows.filter((_, j) => j !== i))}>삭제</button>
          {duplicate(i) && <p className="help" data-tone="warn">같은 이름의 인자가 있어요. 이름을 바꿔야 저장돼요.</p>}
          {!row.key && <p className="help" data-tone="warn">이름을 써야 저장돼요.</p>}
        </div>
      ))}
      <button type="button" className="btn btn--quiet" onClick={() => update([...rows, { key: nextKey(toArgs(rows)), value: "" }])}>인자 추가</button>
    </div>
  );
}

/** The rows that can be written: named, and the first row with that name (a later duplicate waits). */
function toArgs(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.key && !(r.key in out)) out[r.key] = r.value;
  return out;
}

const nextKey = (args: Record<string, string>) => {
  let n = Object.keys(args).length + 1;
  while (`arg${n}` in args) n += 1;
  return `arg${n}`;
};
