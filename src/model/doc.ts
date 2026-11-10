import type { components } from "../api/schema";

type S = components["schemas"];

// The bot document as stored. The generated schema marks fields that have defaults
// (label, exclusive, quick_replies, ...) as required; a stored document may omit them,
// so these local types make them optional. Unknown keys are kept as they are.
export type Step = S["CollectStep"] | S["ActionStep"] | S["RespondStep"] | S["CallStep"] | S["BranchStep"];

export interface SlotDoc {
  entity: string;
  ask?: string | null; // required slots only
  required?: boolean; // default true
  default?: string | number | null; // optional slots only
  validation?: { action: string; fail: string } | null;
  [key: string]: unknown;
}

export interface ScenarioDoc {
  label?: string;
  group?: string | null; // the block's folder in the builder
  trigger?: { intent: string } | null;
  exclusive?: boolean;
  slots?: Record<string, SlotDoc>;
  steps: Step[];
  on_error?: string | null;
  [key: string]: unknown;
}

// Rich bodies: Kakao's skill response fields in snake_case (chatcore bot/schema.py).
export interface LinkDoc { web: string }
export interface ButtonDoc {
  label: string;
  action: "web_link" | "message" | "block" | "phone";
  web_link_url?: string | null;
  message_text?: string | null;
  block_id?: string | null;
  phone_number?: string | null;
}
export interface ThumbnailDoc { image_url: string; alt_text?: string | null; link?: LinkDoc | null; fixed_ratio?: boolean }
export interface SimpleImageDoc { image_url: string; alt_text: string }
export interface BasicCardDoc { title?: string | null; description?: string | null; thumbnail?: ThumbnailDoc | null; buttons?: ButtonDoc[] }
export interface ListItemDoc { title: string; description?: string | null; image_url?: string | null; link?: LinkDoc | null }
export interface ListCardDoc { header: { title: string }; items: ListItemDoc[]; buttons?: ButtonDoc[] }
export interface CarouselDoc { type?: "basic_card"; items: BasicCardDoc[] }

export interface QuickReplyObject {
  label: string;
  action?: "message" | "block"; // default message
  message_text?: string | null;
  block_id?: string | null; // scenario id, for action "block"
}
/** A plain string sends itself (the form every older document uses). */
export type QuickReplyDoc = string | QuickReplyObject;

export const RICH_KINDS = ["simple_image", "basic_card", "list_card", "carousel"] as const;
export type RichKind = (typeof RICH_KINDS)[number];
export type ReplyKind = "text" | RichKind;

export interface ResponseDoc {
  text?: string | null;
  variants?: string[] | null;
  simple_image?: SimpleImageDoc | null;
  basic_card?: BasicCardDoc | null;
  list_card?: ListCardDoc | null;
  carousel?: CarouselDoc | null;
  quick_replies?: QuickReplyDoc[];
}

/** The rich body of a response, or null for text. */
export function richOf(response: ResponseDoc | undefined): { kind: RichKind; body: RichBodyDoc } | null {
  for (const kind of RICH_KINDS) {
    const body = response?.[kind];
    if (body) return { kind, body } as { kind: RichKind; body: RichBodyDoc };
  }
  return null;
}
export type RichBodyDoc = SimpleImageDoc | BasicCardDoc | ListCardDoc | CarouselDoc;

export const quickReplyLabel = (q: QuickReplyDoc): string => (typeof q === "string" ? q : q.label);
export const quickReplyBlock = (q: QuickReplyDoc): string | null => (typeof q === "string" || q.action !== "block" ? null : q.block_id ?? null);

/** Scenario ids a response offers to start directly (quick replies and card buttons). */
export function blockTargets(response: ResponseDoc): string[] {
  const rich = richOf(response);
  const cards = rich?.kind === "basic_card" ? [rich.body as BasicCardDoc]
    : rich?.kind === "carousel" ? (rich.body as CarouselDoc).items : [];
  const buttons = [...cards.flatMap((c) => c.buttons ?? []), ...(rich?.kind === "list_card" ? (rich.body as ListCardDoc).buttons ?? [] : [])];
  return [...(response.quick_replies ?? []).map(quickReplyBlock), ...buttons.map((b) => (b.action === "block" ? b.block_id ?? null : null))]
    .filter((t): t is string => t !== null);
}

export interface IntentDoc {
  label?: string;
  examples: string[];
  exact_only?: boolean; // left out of the classifier: matched only by its exact sentences
}

export interface DictionaryEntityDoc {
  kind: "dictionary";
  label?: string;
  values: Record<string, string[]>;
}

export interface RegexEntityDoc {
  kind: "regex";
  label?: string;
  pattern: string;
}

export type EntityDoc = DictionaryEntityDoc | RegexEntityDoc;

export interface SystemDoc {
  welcome?: string | null; // scenario run when a conversation opens
  escape?: { phrases: string[]; scenario?: string | null } | null;
  timeout?: { minutes: number; notice?: string | null } | null;
  [key: string]: unknown;
}

export interface BotDoc {
  id: string;
  label?: string;
  settings?: { max_attempts?: number; [key: string]: unknown };
  system?: SystemDoc;
  intents?: Record<string, IntentDoc>;
  entities?: Record<string, EntityDoc>;
  scenarios: Record<string, ScenarioDoc>;
  responses: Record<string, ResponseDoc>;
  [key: string]: unknown;
}

/** Responses the engine itself needs (chatcore bot/schema.py REQUIRED_RESPONSES). */
export const REQUIRED_RESPONSES = ["fallback", "cancelled", "restarted", "error", "clarify", "input_invalid"] as const;

/** The engine's system entities (chatcore bot/schema.py SYSTEM_ENTITIES). */
export const SYSTEM_ENTITIES = [
  { id: "sys.number", label: "숫자", examples: "3, 셋, 열두 개" },
  { id: "sys.date", label: "날짜", examples: "내일, 다음 주 월요일, 3월 5일" },
  { id: "sys.time", label: "시각", examples: "오후 3시, 3시 반, 15:30" },
  { id: "sys.text", label: "임의 텍스트", examples: "되묻는 질문에 대한 대답 전체" },
  { id: "sys.number.ordinal", label: "서수", examples: "첫 번째, 3번째, 둘째" },
  { id: "sys.number.age", label: "나이", examples: "25살, 만 25세, 스물다섯 살" },
  { id: "sys.number.percent", label: "퍼센트", examples: "30%, 30프로" },
  { id: "sys.date.period", label: "날짜 기간", examples: "이번 주, 11월 3일부터 5일까지" },
  { id: "sys.time.period", label: "시간대", examples: "오후 2시부터 4시까지" },
  { id: "sys.url", label: "URL", examples: "https://example.com, www.example.com" },
  { id: "sys.unit.currency", label: "통화", examples: "3만 원, $5" },
  { id: "sys.unit.length", label: "길이", examples: "3km, 5센티미터" },
  { id: "sys.unit.weight", label: "무게", examples: "2kg, 500그램" },
  { id: "sys.unit.volume", label: "부피", examples: "500ml, 2리터" },
  { id: "sys.unit.temperature", label: "온도", examples: "25도, 영하 3도" },
  { id: "sys.unit.speed", label: "속도", examples: "시속 60킬로, 100km/h" },
] as const;

/** Kakao channel limits (warnings only; the engine serves any channel). */
export const KAKAO = { bubbles: 3, quickReplies: 10, label: 14, cardButtons: 3, listItems: 5, carousel: 10 } as const;

/** An id matching the engine's ID pattern (^[a-z][a-z0-9_]*$) that is not in `taken`. */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!used.has(id)) return id;
  }
}

/** The record without these keys (a new object). */
export function without<T>(record: Record<string, T>, ...keys: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

export function responseTexts(response: ResponseDoc | undefined): string[] {
  if (!response) return [""];
  if (response.variants != null) return [...response.variants];
  return [response.text ?? ""];
}

/** Write texts back in the response's own shape: `text` stays `text` unless there are now several. */
export function withTexts(response: ResponseDoc | undefined, texts: string[], quickReplies: QuickReplyDoc[]): ResponseDoc {
  const next = withoutRich(response);
  if (response?.variants != null || texts.length > 1) {
    next.variants = texts;
    delete next.text;
  } else {
    next.text = texts[0] ?? "";
    delete next.variants;
  }
  if (quickReplies.length > 0 || response?.quick_replies !== undefined) next.quick_replies = quickReplies;
  return next;
}

/** Drop optional fields left blank in the editor (the engine rejects empty strings); required ones stay,
 * so the engine can name them when they are still empty. */
export function cleanRich(kind: RichKind, body: RichBodyDoc): RichBodyDoc {
  // "" left by the editor goes; an explicit null in a stored document stays (the engine accepts it)
  const blank = (v: unknown) => v === undefined || (typeof v === "string" && !v.trim());
  const prune = <T extends object>(o: T, optional: string[]): T =>
    Object.fromEntries(Object.entries(o).filter(([k, v]) => !(optional.includes(k) && blank(v)))) as T;
  /** Only the target field its action uses (kept even when blank, so the engine names it), plus a message text. */
  const button = (b: ButtonDoc): ButtonDoc => {
    const next: ButtonDoc = { label: b.label, action: b.action };
    if (b.action === "web_link") next.web_link_url = b.web_link_url ?? "";
    if (b.action === "block") next.block_id = b.block_id ?? "";
    if (b.action === "phone") next.phone_number = b.phone_number ?? "";
    if ((b.action === "message" || b.action === "block") && !blank(b.message_text)) next.message_text = b.message_text ?? null;
    return next;
  };
  const card = (c: BasicCardDoc): BasicCardDoc => {
    const next = prune(c, ["title", "description"]);
    const t = next.thumbnail;
    if (t && blank(t.image_url) && blank(t.alt_text ?? undefined) && !t.link?.web) delete next.thumbnail; // nothing left in it
    else if (next.thumbnail) next.thumbnail = prune(next.thumbnail, ["alt_text", "link"]);
    if (next.buttons) next.buttons = next.buttons.map(button);
    return next;
  };
  if (kind === "basic_card") return card(body as BasicCardDoc);
  if (kind === "carousel") return { ...(body as CarouselDoc), items: (body as CarouselDoc).items.map(card) };
  if (kind === "list_card") {
    const list = body as ListCardDoc;
    return { ...list, items: list.items.map((i) => {
      const item = prune(i, ["description", "image_url", "link"]);
      if (item.link && blank(item.link.web)) delete item.link;
      return item;
    }), ...(list.buttons ? { buttons: list.buttons.map(button) } : {}) };
  }
  return body;
}

/** A copy of the response without any rich body. */
function withoutRich(response: ResponseDoc | undefined): ResponseDoc {
  return Object.fromEntries(Object.entries(response ?? {})
    .filter(([k, v]) => v === null || !(RICH_KINDS as readonly string[]).includes(k))) as ResponseDoc; // "basic_card: null" stays
}

/** A rich response: the body replaces any text or other body. */
export function withRich(response: ResponseDoc | undefined, kind: RichKind, body: RichBodyDoc, quickReplies: QuickReplyDoc[]): ResponseDoc {
  const next = withoutRich(response);
  if (next.text !== null) delete next.text; // an explicit null stays
  if (next.variants !== null) delete next.variants;
  (next as Record<string, unknown>)[kind] = cleanRich(kind, body);
  if (quickReplies.length > 0 || response?.quick_replies !== undefined) next.quick_replies = quickReplies;
  return next;
}
