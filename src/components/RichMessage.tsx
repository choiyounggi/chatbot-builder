import "../styles/chat.css";
import type { TestMessage } from "../api/types";

type BasicCardBody = NonNullable<TestMessage["basic_card"]>;
type ListCardBody = NonNullable<TestMessage["list_card"]>;
type CarouselBody = NonNullable<TestMessage["carousel"]>;
type SimpleImageBody = NonNullable<TestMessage["simple_image"]>;
type ButtonBody = NonNullable<BasicCardBody["buttons"]>[number];
type QuickReplyItemBody = NonNullable<TestMessage["quick_reply_items"]>[number];

/** Send a message, optionally starting a block directly (a quick reply or button was pressed). */
export type SendAction = (text: string, blockId?: string) => void;

export interface QuickReplyItem {
  label: string;
  action: "message" | "block";
  messageText: string | null;
  blockId: string | null;
}

const isHttpUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//.test(url);

/** `quick_reply_items` when the engine sent any, else `quick_replies` as plain message replies
 * (an older engine may not know about block quick replies yet). */
export function quickReplyItems(message: TestMessage): QuickReplyItem[] {
  if (message.quick_reply_items && message.quick_reply_items.length > 0) {
    return message.quick_reply_items.map((q: QuickReplyItemBody) => ({ label: q.label, action: q.action, messageText: q.message_text, blockId: q.block_id }));
  }
  return message.quick_replies.map((label) => ({ label, action: "message", messageText: label, blockId: null }));
}

export function QuickReplies({ message, interactive, disabled, onAction }: { message: TestMessage; interactive: boolean; disabled: boolean; onAction: SendAction }) {
  if (!interactive) return null;
  const items = quickReplyItems(message);
  if (items.length === 0) return null;
  return (
    <div className="chips">
      {items.map((q, i) => (
        <button key={i} type="button" className="btn btn--quiet chip-btn" disabled={disabled}
                onClick={() => onAction(q.messageText ?? q.label, q.action === "block" ? (q.blockId ?? undefined) : undefined)}>
          {q.label}
        </button>
      ))}
    </div>
  );
}

function ButtonView({ button, disabled, onAction }: { button: ButtonBody; disabled: boolean; onAction: SendAction }) {
  if (button.action === "web_link") {
    return isHttpUrl(button.web_link_url)
      ? <a className="btn btn--quiet chip-btn" href={button.web_link_url} target="_blank" rel="noopener noreferrer">{button.label}</a>
      : <span className="chip-btn">{button.label}</span>;
  }
  if (button.action === "phone") {
    return button.phone_number
      ? <a className="btn btn--quiet chip-btn" href={`tel:${button.phone_number}`}>{button.label}</a>
      : <span className="chip-btn">{button.label}</span>;
  }
  const blockId = button.action === "block" ? (button.block_id ?? undefined) : undefined;
  return (
    <button type="button" className="btn btn--quiet chip-btn" disabled={disabled} onClick={() => onAction(button.message_text ?? button.label, blockId)}>
      {button.label}
    </button>
  );
}

function ButtonRow({ buttons, disabled, onAction }: { buttons?: ButtonBody[]; disabled: boolean; onAction: SendAction }) {
  if (!buttons || buttons.length === 0) return null;
  return (
    <div className="chips">
      {buttons.map((b, i) => <ButtonView key={i} button={b} disabled={disabled} onAction={onAction} />)}
    </div>
  );
}

function SimpleImageView({ image }: { image: SimpleImageBody }) {
  return isHttpUrl(image.image_url)
    ? <img src={image.image_url} alt={image.alt_text} loading="lazy" className="rich-image" />
    : <p>{image.alt_text}</p>;
}

function BasicCardView({ card, interactive, disabled, onAction }: { card: BasicCardBody; interactive: boolean; disabled: boolean; onAction: SendAction }) {
  return (
    <div className="rich-card">
      {card.thumbnail && isHttpUrl(card.thumbnail.image_url) && (
        <img src={card.thumbnail.image_url} alt={card.thumbnail.alt_text ?? ""} loading="lazy" className="rich-card__image" />
      )}
      {card.title && <p className="rich-card__title" role="heading" aria-level={3}>{card.title}</p>}
      {card.description && <p className="rich-card__desc">{card.description}</p>}
      {interactive && <ButtonRow buttons={card.buttons} disabled={disabled} onAction={onAction} />}
    </div>
  );
}

function ListCardView({ card, interactive, disabled, onAction }: { card: ListCardBody; interactive: boolean; disabled: boolean; onAction: SendAction }) {
  return (
    <div className="rich-list">
      <p className="rich-list__header" role="heading" aria-level={3}>{card.header.title}</p>
      <ul className="rich-list__items">
        {card.items.map((item, i) => {
          const href = item.link?.web;
          return (
            <li key={i} className="rich-list__item">
              {item.image_url && isHttpUrl(item.image_url) && <img src={item.image_url} alt="" loading="lazy" className="rich-list__image" />}
              <div className="rich-list__body">
                {isHttpUrl(href)
                  ? <a className="rich-list__title" href={href} target="_blank" rel="noopener noreferrer">{item.title}</a>
                  : <span className="rich-list__title">{item.title}</span>}
                {item.description && <p className="rich-list__desc">{item.description}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {interactive && <ButtonRow buttons={card.buttons} disabled={disabled} onAction={onAction} />}
    </div>
  );
}

function CarouselView({ carousel, interactive, disabled, onAction }: { carousel: CarouselBody; interactive: boolean; disabled: boolean; onAction: SendAction }) {
  return (
    <div className="rich-carousel" role="group" aria-label={`카드 ${carousel.items.length}장`}>
      {carousel.items.map((card, i) => (
        <div key={i} className="rich-carousel__item">
          <BasicCardView card={card} interactive={interactive} disabled={disabled} onAction={onAction} />
        </div>
      ))}
    </div>
  );
}

export interface RichMessageProps {
  message: TestMessage;
  interactive: boolean;
  disabled: boolean;
  onAction: SendAction;
}

/** The body of one bot message: a text bubble, or the matching rich body (image/card/list/carousel). */
export function RichMessage({ message, interactive, disabled, onAction }: RichMessageProps) {
  const type = message.type ?? "text";
  if (type === "simple_image" && message.simple_image) return <SimpleImageView image={message.simple_image} />;
  if (type === "basic_card" && message.basic_card) return <BasicCardView card={message.basic_card} interactive={interactive} disabled={disabled} onAction={onAction} />;
  if (type === "list_card" && message.list_card) return <ListCardView card={message.list_card} interactive={interactive} disabled={disabled} onAction={onAction} />;
  if (type === "carousel" && message.carousel) return <CarouselView carousel={message.carousel} interactive={interactive} disabled={disabled} onAction={onAction} />;
  return <p>{message.text}</p>;
}
