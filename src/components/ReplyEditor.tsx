// One speech bubble of a block: text (or random variants), an image, a card, a list or a carousel,
// plus its quick replies. Fields follow Kakao's skill response format (chatcore bot/schema.py).
import type { ReactNode } from "react";
import type { Reply } from "../model/blocks";
import {
  type BasicCardDoc, type ButtonDoc, type CarouselDoc, KAKAO, type ListCardDoc, type QuickReplyDoc, quickReplyLabel,
  type ReplyKind, type RichBodyDoc, type SimpleImageDoc,
} from "../model/doc";

export interface BlockOption {
  id: string;
  label: string;
}

const KIND_LABEL: Record<ReplyKind, string> = {
  text: "텍스트", simple_image: "이미지", basic_card: "기본 카드", list_card: "리스트 카드", carousel: "케로셀",
};

const EMPTY: Record<Exclude<ReplyKind, "text">, () => RichBodyDoc> = {
  simple_image: () => ({ image_url: "", alt_text: "" }),
  basic_card: () => ({ title: "", description: "", buttons: [] }),
  list_card: () => ({ header: { title: "" }, items: [{ title: "" }], buttons: [] }),
  carousel: () => ({ type: "basic_card", items: [{ title: "", description: "", buttons: [] }] }),
};

const hasContent = (reply: Reply) => (reply.kind === "text" ? reply.texts.some((t) => t.trim()) : reply.rich !== null);

function Warn({ children }: { children: ReactNode }) {
  return <p className="help" data-tone="warn">{children}</p>;
}

function Field({ id, label, value, onChange, placeholder, multiline }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline
        ? <textarea id={id} className="input" rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function BlockSelect({ id, label, value, blocks, onChange }: {
  id: string; label: string; value: string; blocks: BlockOption[]; onChange: (v: string) => void;
}) {
  const known = blocks.some((b) => b.id === value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">블록 선택</option>
        {!known && value && <option value={value}>{value} (없는 블록)</option>}
        {blocks.map((b) => <option key={b.id} value={b.id}>{b.label || b.id}</option>)}
      </select>
    </div>
  );
}

export function ReplyEditor({ reply, index, blocks, onChange, onRemove, textOnly = false }: {
  reply: Reply; index: number; blocks: BlockOption[]; onChange: (r: Reply) => void; onRemove?: () => void; textOnly?: boolean;
}) {
  const n = index + 1;
  const name = `응답 ${n}`;
  const texts = reply.texts.length ? reply.texts : [""];
  const random = reply.kind === "text" && reply.texts.length > 1;
  const switchKind = (kind: ReplyKind) => {
    if (kind === reply.kind) return;
    if (hasContent(reply) && !window.confirm(`${name}의 지금 내용이 지워져요. ${KIND_LABEL[kind]}(으)로 바꿀까요?`)) return;
    onChange(kind === "text" ? { ...reply, kind, rich: null, texts: [""] } : { ...reply, kind, rich: EMPTY[kind](), texts: [] });
  };
  return (
    <div className="reply">
      <div className="reply-head">
        <span className="status">{name}{random ? " · 랜덤" : ""}</span>
        <span className="mono status">{reply.response}</span>
        {onRemove && <button type="button" className="btn btn--quiet" onClick={onRemove} aria-label={`${name} 삭제`}>삭제</button>}
      </div>
      {reply.sharedWith ? (
        <p className="status">{reply.sharedWith}와 같은 응답이에요. 그곳에서 고치면 여기도 바뀌어요.</p>
      ) : (
        <>
          {reply.missing && <Warn>초안에 이 응답({reply.response})이 없어요. 내용을 쓰면 새로 만들어져요.</Warn>}
          {!textOnly && (
            <div className="field">
              <label htmlFor={`kind-${index}`}>{name} 형식</label>
              <select id={`kind-${index}`} className="input" value={reply.kind} onChange={(e) => switchKind(e.target.value as ReplyKind)}>
                {(Object.keys(KIND_LABEL) as ReplyKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
          )}
          {reply.kind === "text" && (
            <>
              {texts.map((text, i) => (
                <div className="reply-text" key={i}>
                  <label className="visually-hidden" htmlFor={`reply-${index}-${i}`}>{name} 문구 {i + 1}</label>
                  <textarea id={`reply-${index}-${i}`} className="input" rows={2} value={text}
                            onChange={(e) => onChange({ ...reply, texts: texts.map((t, j) => (j === i ? e.target.value : t)) })} />
                  {random && (
                    <button type="button" className="btn btn--quiet" aria-label={`${name} 문구 ${i + 1} 삭제`}
                            onClick={() => onChange({ ...reply, texts: reply.texts.filter((_, j) => j !== i) })}>삭제</button>
                  )}
                </div>
              ))}
              <button type="button" className="btn btn--quiet" onClick={() => onChange({ ...reply, texts: [...texts, ""] })}>랜덤 문구 추가</button>
            </>
          )}
          {reply.kind === "simple_image" && reply.rich && (
            <ImageEditor id={`img-${index}`} name={name} image={reply.rich as SimpleImageDoc} onChange={(rich) => onChange({ ...reply, rich })} />
          )}
          {reply.kind === "basic_card" && reply.rich && (
            <CardEditor id={`card-${index}`} name={name} card={reply.rich as BasicCardDoc} blocks={blocks}
                        onChange={(rich) => onChange({ ...reply, rich })} />
          )}
          {reply.kind === "list_card" && reply.rich && (
            <ListEditor id={`list-${index}`} name={name} list={reply.rich as ListCardDoc} blocks={blocks}
                        onChange={(rich) => onChange({ ...reply, rich })} />
          )}
          {reply.kind === "carousel" && reply.rich && (
            <CarouselEditor id={`car-${index}`} name={name} carousel={reply.rich as CarouselDoc} blocks={blocks}
                            onChange={(rich) => onChange({ ...reply, rich })} />
          )}
          <QuickReplyEditor id={`qr-${index}`} name={name} value={reply.quickReplies} blocks={blocks}
                            onChange={(quickReplies) => onChange({ ...reply, quickReplies })} />
        </>
      )}
    </div>
  );
}

function ImageEditor({ id, name, image, onChange }: { id: string; name: string; image: SimpleImageDoc; onChange: (i: SimpleImageDoc) => void }) {
  return (
    <div className="rich-fields">
      <Field id={`${id}-url`} label={`${name} 이미지 주소`} value={image.image_url} placeholder="https://"
             onChange={(image_url) => onChange({ ...image, image_url })} />
      <Field id={`${id}-alt`} label={`${name} 대체 텍스트`} value={image.alt_text} placeholder="이미지를 볼 수 없을 때 보이는 설명"
             onChange={(alt_text) => onChange({ ...image, alt_text })} />
    </div>
  );
}

function CardEditor({ id, name, card, blocks, onChange }: {
  id: string; name: string; card: BasicCardDoc; blocks: BlockOption[]; onChange: (c: BasicCardDoc) => void;
}) {
  const thumb = card.thumbnail ?? { image_url: "" };
  return (
    <div className="rich-fields">
      <Field id={`${id}-title`} label={`${name} 제목`} value={card.title ?? ""} onChange={(title) => onChange({ ...card, title })} />
      <Field id={`${id}-desc`} label={`${name} 설명`} value={card.description ?? ""} multiline
             onChange={(description) => onChange({ ...card, description })} />
      <Field id={`${id}-thumb`} label={`${name} 썸네일 이미지 주소`} value={thumb.image_url} placeholder="https://"
             onChange={(image_url) => onChange({ ...card, thumbnail: { ...thumb, image_url } })} />
      {thumb.image_url && (
        <Field id={`${id}-thumb-alt`} label={`${name} 썸네일 대체 텍스트`} value={thumb.alt_text ?? ""}
               onChange={(alt_text) => onChange({ ...card, thumbnail: { ...thumb, alt_text } })} />
      )}
      <ButtonsEditor id={`${id}-btn`} name={name} buttons={card.buttons ?? []} blocks={blocks}
                     onChange={(buttons) => onChange({ ...card, buttons })} />
    </div>
  );
}

function ListEditor({ id, name, list, blocks, onChange }: {
  id: string; name: string; list: ListCardDoc; blocks: BlockOption[]; onChange: (l: ListCardDoc) => void;
}) {
  const setItem = (i: number, patch: Partial<ListCardDoc["items"][number]>) =>
    onChange({ ...list, items: list.items.map((item, j) => (j === i ? { ...item, ...patch } : item)) });
  return (
    <div className="rich-fields">
      <Field id={`${id}-header`} label={`${name} 리스트 제목`} value={list.header.title}
             onChange={(title) => onChange({ ...list, header: { title } })} />
      {list.items.map((item, i) => (
        <fieldset className="rich-item" key={i}>
          <legend>항목 {i + 1}</legend>
          <Field id={`${id}-${i}-title`} label={`${name} 항목 ${i + 1} 제목`} value={item.title} onChange={(title) => setItem(i, { title })} />
          <Field id={`${id}-${i}-desc`} label={`${name} 항목 ${i + 1} 설명`} value={item.description ?? ""}
                 onChange={(description) => setItem(i, { description })} />
          <Field id={`${id}-${i}-img`} label={`${name} 항목 ${i + 1} 이미지 주소`} value={item.image_url ?? ""} placeholder="https://"
                 onChange={(image_url) => setItem(i, { image_url })} />
          <Field id={`${id}-${i}-link`} label={`${name} 항목 ${i + 1} 링크`} value={item.link?.web ?? ""} placeholder="https://"
                 onChange={(web) => setItem(i, { link: { web } })} />
          {list.items.length > 1 && (
            <button type="button" className="btn btn--quiet" aria-label={`${name} 항목 ${i + 1} 삭제`}
                    onClick={() => onChange({ ...list, items: list.items.filter((_, j) => j !== i) })}>항목 삭제</button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn--quiet" onClick={() => onChange({ ...list, items: [...list.items, { title: "" }] })}>항목 추가</button>
      {list.items.length > KAKAO.listItems && <Warn>리스트 항목은 카카오 채널에서 {KAKAO.listItems}개까지만 보여요.</Warn>}
      <ButtonsEditor id={`${id}-btn`} name={name} buttons={list.buttons ?? []} blocks={blocks}
                     onChange={(buttons) => onChange({ ...list, buttons })} />
    </div>
  );
}

function CarouselEditor({ id, name, carousel, blocks, onChange }: {
  id: string; name: string; carousel: CarouselDoc; blocks: BlockOption[]; onChange: (c: CarouselDoc) => void;
}) {
  return (
    <div className="rich-fields">
      {carousel.items.map((card, i) => (
        <fieldset className="rich-item" key={i}>
          <legend>카드 {i + 1}</legend>
          <CardEditor id={`${id}-${i}`} name={`${name} 카드 ${i + 1}`} card={card} blocks={blocks}
                      onChange={(next) => onChange({ ...carousel, items: carousel.items.map((c, j) => (j === i ? next : c)) })} />
          {carousel.items.length > 1 && (
            <button type="button" className="btn btn--quiet" aria-label={`${name} 카드 ${i + 1} 삭제`}
                    onClick={() => onChange({ ...carousel, items: carousel.items.filter((_, j) => j !== i) })}>카드 삭제</button>
          )}
        </fieldset>
      ))}
      <button type="button" className="btn btn--quiet"
              onClick={() => onChange({ ...carousel, items: [...carousel.items, { title: "", description: "", buttons: [] }] })}>카드 추가</button>
      {carousel.items.length > KAKAO.carousel && <Warn>케로셀은 카카오 채널에서 {KAKAO.carousel}장까지만 보여요.</Warn>}
    </div>
  );
}

const BUTTON_ACTIONS: Record<ButtonDoc["action"], string> = {
  web_link: "웹 링크 열기", message: "메시지 보내기", block: "블록으로 이동", phone: "전화 걸기",
};

function ButtonsEditor({ id, name, buttons, blocks, onChange }: {
  id: string; name: string; buttons: ButtonDoc[]; blocks: BlockOption[]; onChange: (b: ButtonDoc[]) => void;
}) {
  const set = (i: number, next: ButtonDoc) => onChange(buttons.map((b, j) => (j === i ? next : b)));
  return (
    <div className="rich-buttons">
      {buttons.map((b, i) => {
        const n = `${name} 버튼 ${i + 1}`;
        return (
          <fieldset className="rich-item" key={i}>
            <legend>버튼 {i + 1}</legend>
            <Field id={`${id}-${i}-label`} label={`${n} 이름`} value={b.label} onChange={(label) => set(i, { ...b, label })} />
            <div className="field">
              <label htmlFor={`${id}-${i}-action`}>{n} 동작</label>
              <select id={`${id}-${i}-action`} className="input" value={b.action}
                      onChange={(e) => set(i, { label: b.label, action: e.target.value as ButtonDoc["action"] })}>
                {(Object.keys(BUTTON_ACTIONS) as ButtonDoc["action"][]).map((a) => <option key={a} value={a}>{BUTTON_ACTIONS[a]}</option>)}
              </select>
            </div>
            {b.action === "web_link" && <Field id={`${id}-${i}-url`} label={`${n} 주소`} value={b.web_link_url ?? ""} placeholder="https://"
                                               onChange={(web_link_url) => set(i, { ...b, web_link_url })} />}
            {b.action === "phone" && <Field id={`${id}-${i}-phone`} label={`${n} 전화번호`} value={b.phone_number ?? ""} placeholder="02-123-4567"
                                            onChange={(phone_number) => set(i, { ...b, phone_number })} />}
            {b.action === "block" && <BlockSelect id={`${id}-${i}-block`} label={`${n} 이동할 블록`} value={b.block_id ?? ""} blocks={blocks}
                                                  onChange={(block_id) => set(i, { ...b, block_id })} />}
            {(b.action === "message" || b.action === "block") && (
              <Field id={`${id}-${i}-msg`} label={`${n} 보낼 메시지`} value={b.message_text ?? ""} placeholder="비우면 버튼 이름을 보내요"
                     onChange={(message_text) => set(i, { ...b, message_text })} />
            )}
            {b.label.length > KAKAO.label && <Warn>버튼 이름은 카카오 채널에서 {KAKAO.label}자까지 보여요.</Warn>}
            <button type="button" className="btn btn--quiet" aria-label={`${n} 삭제`}
                    onClick={() => onChange(buttons.filter((_, j) => j !== i))}>버튼 삭제</button>
          </fieldset>
        );
      })}
      <button type="button" className="btn btn--quiet" onClick={() => onChange([...buttons, { label: "", action: "message" }])}>버튼 추가</button>
      {buttons.length > KAKAO.cardButtons && <Warn>카드 버튼은 카카오 채널에서 {KAKAO.cardButtons}개까지만 보여요.</Warn>}
    </div>
  );
}

/** A quick reply in its stored form: a plain string when it only sends its own label. */
function quickReply(label: string, action: "message" | "block", messageText: string, blockId: string): QuickReplyDoc {
  if (action === "message" && !messageText) return label;
  return { label, action, ...(messageText ? { message_text: messageText } : {}), ...(action === "block" ? { block_id: blockId } : {}) };
}

function QuickReplyEditor({ id, name, value, blocks, onChange }: {
  id: string; name: string; value: QuickReplyDoc[]; blocks: BlockOption[]; onChange: (v: QuickReplyDoc[]) => void;
}) {
  const parts = (q: QuickReplyDoc) => (typeof q === "string"
    ? { label: q, action: "message" as const, message: "", block: "" }
    : { label: q.label, action: q.action ?? "message", message: q.message_text ?? "", block: q.block_id ?? "" });
  const set = (i: number, patch: Partial<ReturnType<typeof parts>>) => onChange(value.map((q, j) => {
    if (j !== i) return q;
    const p = { ...parts(q), ...patch };
    return quickReply(p.label, p.action, p.message, p.block);
  }));
  const long = value.map(quickReplyLabel).filter((l) => l.length > KAKAO.label);
  return (
    <fieldset className="quick-replies">
      <legend>{name} 바로연결</legend>
      {value.map((q, i) => {
        const p = parts(q);
        const n = `${name} 바로연결 ${i + 1}`;
        return (
          <div className="quick-reply" key={i}>
            <div className="field">
              <label htmlFor={`${id}-${i}-label`}>{n} 이름</label>
              <input id={`${id}-${i}-label`} className="input" value={p.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-${i}-action`}>{n} 동작</label>
              <select id={`${id}-${i}-action`} className="input" value={p.action}
                      onChange={(e) => set(i, { action: e.target.value as "message" | "block" })}>
                <option value="message">메시지 보내기</option>
                <option value="block">블록으로 이동</option>
              </select>
            </div>
            {p.action === "block" && (
              <BlockSelect id={`${id}-${i}-block`} label={`${n} 이동할 블록`} value={p.block} blocks={blocks} onChange={(block) => set(i, { block })} />
            )}
            <button type="button" className="btn btn--quiet" aria-label={`${n} 삭제`}
                    onClick={() => onChange(value.filter((_, j) => j !== i))}>삭제</button>
          </div>
        );
      })}
      <button type="button" className="btn btn--quiet" onClick={() => onChange([...value, ""])}>바로연결 추가</button>
      <p className="help">메시지 보내기는 이름을 사용자가 말한 것처럼 보내고, 블록으로 이동은 발화를 해석하지 않고 그 블록을 바로 시작해요.</p>
      {value.length > KAKAO.quickReplies && <Warn>바로연결은 카카오 채널에서 {KAKAO.quickReplies}개까지만 보여요.</Warn>}
      {long.length > 0 && <Warn>카카오 채널에서는 {KAKAO.label}자까지만 보여요: {long.join(", ")}</Warn>}
    </fieldset>
  );
}
