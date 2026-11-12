// Web chat (engine E-G): which sites may embed the bot's chat window, how it looks, and the code to embed it.
import { bot, request } from "./client";
import type { components } from "./schema";

export type WebOut = components["schemas"]["WebOut"];
export type WebSettings = Omit<WebOut, "bot">;

export const MAX_ORIGINS = 20;
const ORIGIN = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:[0-9]{1,5})?$/;

export async function getWeb(id: string): Promise<WebOut> {
  return (await (await request(`${bot(id)}/web`)).json()) as WebOut;
}

/** 422: the engine refused a value (the screen checks the same rules first). */
export async function saveWeb(id: string, settings: WebSettings): Promise<WebOut> {
  const res = await request(`${bot(id)}/web`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
  });
  return (await res.json()) as WebOut;
}

/** An origin as browsers send it (lower case, no default port), or null when it is not one — the
 * engine's own rule (chatcore/web.py normalize_origin). */
export function normalizeOrigin(value: string): string | null {
  const text = value.trim().toLowerCase();
  const match = ORIGIN.exec(text);
  if (!match) return null;
  const port = match[5];
  if (port !== undefined) {
    const n = Number(port.slice(1));
    if (n < 1 || n > 65535) return null;
    // compared as written, like the engine (":00080" stays)
    if ((text.startsWith("https://") && port === ":443") || (text.startsWith("http://") && port === ":80")) return text.slice(0, -port.length);
  }
  return text;
}

export interface OriginCheck {
  origins: string[]; // normalised, in order, without blank lines
  problems: string[]; // what the builder must fix before saving
}

/** One origin per line, as typed. */
export function checkOrigins(text: string): OriginCheck {
  const origins: string[] = [];
  const problems: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const origin = normalizeOrigin(line);
    if (origin === null) problems.push(`‘${line}’은(는) 주소 형식이 아니에요. https://example.com 처럼 경로 없이 써 주세요.`);
    else if (origins.includes(origin)) problems.push(`‘${origin}’이(가) 두 번 있어요.`);
    else origins.push(origin);
  }
  if (origins.length > MAX_ORIGINS) problems.push(`허용 도메인은 ${MAX_ORIGINS}개까지예요.`);
  return { origins, problems };
}

const attr = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The one-line script a site adds (docs: chatbot-widget README). */
export function scriptSnippet(widgetUrl: string, engineUrl: string, botId: string): string {
  return `<script src="${attr(`${widgetUrl.replace(/\/+$/, "")}/chatbot.js`)}" data-engine="${attr(engineUrl.replace(/\/+$/, ""))}" data-bot="${attr(botId)}" async></script>`;
}

/** The page an app opens in its webview. */
export function webviewUrl(widgetUrl: string, engineUrl: string, botId: string): string {
  const params = new URLSearchParams({ engine: engineUrl.replace(/\/+$/, ""), bot: botId, close: "1" });
  return `${widgetUrl.replace(/\/+$/, "")}/chat.html?${params.toString()}`;
}
