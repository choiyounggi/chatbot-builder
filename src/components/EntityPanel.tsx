import { type FormEvent, useState } from "react";
import { useDraft } from "../draft/DraftContext";
import { type BotDoc, type DictionaryEntityDoc, newId, SYSTEM_ENTITIES, without } from "../model/doc";
import { parseList } from "../pages/Scenarios";

/** Blocks whose parameters use this entity: it cannot be deleted while they do. */
export function usersOf(doc: BotDoc, entity: string): string[] {
  return Object.entries(doc.scenarios)
    .filter(([, s]) => Object.values(s.slots ?? {}).some((slot) => slot.entity === entity))
    .map(([id, s]) => s.label || id);
}

export function EntityPanel() {
  const draft = useDraft();
  const [tab, setTab] = useState<"mine" | "system">("mine");
  const [problem, setProblem] = useState<string | null>(null);
  const doc = draft.doc;
  if (!doc) return <p className="status">초안을 불러오는 중…</p>;
  const entities = Object.entries(doc.entities ?? {});

  const setEntity = (id: string, entity: DictionaryEntityDoc) =>
    draft.update((d) => ({ ...d, entities: { ...d.entities, [id]: entity } }));
  const remove = (id: string) => {
    const users = usersOf(doc, id);
    if (users.length > 0) {
      setProblem(`이 엔티티를 쓰는 블록이 있어요: ${users.join(", ")}. 그 블록의 파라미터를 먼저 바꿔 주세요.`);
      return;
    }
    setProblem(null);
    draft.update((d) => ({ ...d, entities: without(d.entities ?? {}, id) }));
  };
  const add = () => {
    const id = newId("entity", Object.keys(doc.entities ?? {}));
    setEntity(id, { kind: "dictionary", label: "새 엔티티", values: {} });
  };

  return (
    <div className="entity-panel">
      <div className="tabs" role="group" aria-label="엔티티 종류">
        <button type="button" aria-pressed={tab === "mine"} className="btn btn--quiet" onClick={() => setTab("mine")}>나의 엔티티</button>
        <button type="button" aria-pressed={tab === "system"} className="btn btn--quiet" onClick={() => setTab("system")}>시스템 엔티티</button>
      </div>
      {tab === "system" ? (
        <ul className="sys-entities">
          {SYSTEM_ENTITIES.map((e) => (
            <li key={e.id}><code>{e.id}</code> {e.label}<span className="status"> · {e.examples}</span></li>
          ))}
        </ul>
      ) : (
        <>
          {problem && <p className="notice" data-tone="warn" role="alert">{problem}</p>}
          {entities.length === 0 && <p className="status">아직 엔티티가 없어요.</p>}
          {entities.map(([id, entity]) => (
            <section key={id} className="entity" aria-label={`엔티티 ${entity.label || id}`}>
              <div className="entity-head">
                <label className="visually-hidden" htmlFor={`entity-label-${id}`}>엔티티 이름</label>
                <input id={`entity-label-${id}`} className="input" value={entity.label ?? ""} placeholder={id}
                       onChange={(e) => draft.update((d) => ({ ...d, entities: { ...d.entities, [id]: { ...entity, label: e.target.value } } }))} />
                <span className="mono status">{id}</span>
                <button type="button" className="btn btn--quiet" onClick={() => remove(id)} aria-label={`엔티티 ${entity.label || id} 삭제`}>삭제</button>
              </div>
              {entity.kind === "regex" ? (
                <p className="status">정규식 <code>{entity.pattern}</code> (편집은 다음 단계에서)</p>
              ) : (
                <Values entity={entity} onChange={(values) => setEntity(id, { ...entity, values })} />
              )}
            </section>
          ))}
          <button type="button" className="btn" onClick={add}>엔티티 추가</button>
        </>
      )}
    </div>
  );
}

function Values({ entity, onChange }: { entity: DictionaryEntityDoc; onChange: (values: Record<string, string[]>) => void }) {
  const [canonical, setCanonical] = useState("");
  const rows = Object.entries(entity.values);
  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = canonical.trim();
    if (!value || value in entity.values) return;
    onChange({ ...entity.values, [value]: [] });
    setCanonical("");
  };
  return (
    <>
      <p className="status">대표값 {rows.length}개 · 동의어는 쉼표로 구분해요</p>
      <ul className="values">
        {rows.map(([value, synonyms]) => (
          <li key={value}>
            <strong>{value}</strong>
            <Synonyms value={value} synonyms={synonyms} onChange={(next) => onChange({ ...entity.values, [value]: next })} />
            <button type="button" className="btn btn--quiet" aria-label={`대표값 ${value} 삭제`}
                    onClick={() => onChange(without(entity.values, value))}>삭제</button>
          </li>
        ))}
      </ul>
      <form className="inline-add" onSubmit={add}>
        <label className="visually-hidden" htmlFor="new-canonical">새 대표값</label>
        <input id="new-canonical" className="input" value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="대표값 (예: 서울)" />
        <button type="submit" className="btn" disabled={!canonical.trim() || canonical.trim() in entity.values}>추가</button>
      </form>
    </>
  );
}

function Synonyms({ value, synonyms, onChange }: { value: string; synonyms: string[]; onChange: (s: string[]) => void }) {
  const [text, setText] = useState(synonyms.join(", "));
  return (
    <>
      <label className="visually-hidden" htmlFor={`syn-${value}`}>{value} 동의어</label>
      <input id={`syn-${value}`} className="input" value={text} placeholder="동의어 (예: 서울시, 서울특별시)"
             onChange={(e) => { setText(e.target.value); onChange(parseList(e.target.value)); }} />
    </>
  );
}
