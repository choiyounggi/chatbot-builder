import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient, Providers } from "../App";
import type { BotSummary } from "../api/types";
import sample from "./fixtures/sample-bot.json";

export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | "network-error";
export type Handler = (init: RequestInit & { url: string }) => Reply | Promise<Reply>;

/** A fake engine: routes are "METHOD /path". Unknown routes answer 404. With `token`, every
 * route answers 401 unless that bearer token is sent (as the engine does). Returns the fetch mock. */
export function fakeEngine(routes: Record<string, Handler>, options: { token?: string | undefined } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = routes[`${init.method ?? "GET"} ${url}`];
    const authorized = !options.token || headerOf(init, "Authorization") === `Bearer ${options.token}`;
    const reply: Reply = !authorized ? { status: 401, body: { detail: "builder endpoints need the admin token" } }
      : handler ? await handler({ ...init, url }) : { status: 404, body: { detail: "not found" } };
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json", ...reply.headers },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderAt(path: string) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
}

export const SAMPLE: BotSummary = {
  id: "sample", label: "샘플 봇", live: "2f1942ec91ab", live_number: 3, serving: "2f1942ec91ab",
  draft_revision: 4, undeployed_changes: false,
};

export function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

export interface BotEngineOptions {
  doc?: Record<string, unknown>; // the stored draft (default: a copy of the sample bot)
  token?: string;
  errors?: string[]; // problems reported on save (valid: false)
  putReplies?: Reply[]; // canned replies for the first PUTs
  failDraftAfter?: number; // GET draft answers 500 after this many reads
  buildFails?: boolean;
  chat?: (text: string, build: string) => Reply; // test chat replies (default: echo)
  putGate?: Promise<void>; // PUT waits for this (to edit while a save is in flight)
  jobsForgotten?: boolean; // GET job answers 404 (the engine restarted)
}

/** A stateful fake engine for one bot ("sample"): ETag rules, test builds as jobs, test chat. */
export function botEngine(options: BotEngineOptions = {}) {
  const state = {
    doc: structuredClone(options.doc ?? (sample as Record<string, unknown>)),
    revision: 4,
    reads: 0,
    builds: 0,
    jobs: new Map<string, { status: string; result: unknown; error: unknown }>(),
    puts: [] as { etag: string | null; body: Record<string, unknown> }[],
    chats: [] as { build: string; session: string; text: string }[],
    jobPolls: 0,
  };
  const auth = { token: options.token };
  const pending = [...(options.putReplies ?? [])];
  const job = (id: string) => ({ id, kind: "test_build", bot: "sample", created_at: "2026-11-10T00:00:00+00:00", ...state.jobs.get(id) });
  const routes: Record<string, Handler> = {
    "GET /v1/builder/bots": () => ({ body: { bots: [{ ...SAMPLE, label: String(state.doc.label ?? ""), draft_revision: state.revision }] } }),
    "GET /v1/builder/bots/sample/draft": () => {
      state.reads += 1;
      if (options.failDraftAfter !== undefined && state.reads > options.failDraftAfter) return { status: 500, body: { detail: "internal error" } };
      return { body: state.doc, headers: { ETag: `"${state.revision}"` } };
    },
    "PUT /v1/builder/bots/sample/draft": async (init) => {
      await options.putGate;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.puts.push({ etag: headerOf(init, "If-Match"), body });
      const canned = pending.shift();
      if (canned) return canned;
      if (headerOf(init, "If-Match") !== `"${state.revision}"`) return { status: 412, body: { detail: "moved", revision: state.revision } };
      state.revision += 1;
      state.doc = body;
      const errors = options.errors ?? [];
      return { body: { bot: "sample", version: `v${state.revision}`.padEnd(12, "0"), revision: state.revision, valid: errors.length === 0, errors, warnings: [] },
               headers: { ETag: `"${state.revision}"` } };
    },
    "POST /v1/builder/bots/sample/test-builds": () => {
      state.builds += 1;
      const id = String(state.builds).padStart(32, "0");
      const build = `b${state.revision}`.padEnd(12, "0");
      state.jobs.set(id, options.buildFails
        ? { status: "failed", result: null, error: { kind: "training", detail: "need at least two intents" } }
        : { status: "done", result: { build }, error: null });
      return { status: 202, body: { ...job(id), status: "queued", result: null, error: null, finished_at: null } };
    },
  };
  const fetchMock = fakeEngine(new Proxy(routes, {
    get(target, key: string) {
      if (key in target) return target[key];
      const jobMatch = key.match(/^GET \/v1\/builder\/jobs\/(\w+)$/);
      if (jobMatch?.[1] && options.jobsForgotten) {
        return () => { state.jobPolls += 1; return { status: 404, body: { detail: "unknown job" } }; };
      }
      if (jobMatch?.[1] && state.jobs.has(jobMatch[1])) return () => ({ body: { ...job(jobMatch[1] as string), finished_at: "2026-11-10T00:00:01+00:00" } });
      const chatMatch = key.match(/^POST \/v1\/builder\/bots\/sample\/test\/(\w+)\/sessions\/([\w-]+)\/messages$/);
      if (chatMatch) {
        return (init: RequestInit) => {
          const text = (JSON.parse(String(init.body)) as { text: string }).text;
          state.chats.push({ build: chatMatch[1] as string, session: chatMatch[2] as string, text });
          return options.chat?.(text, chatMatch[1] as string) ?? { body: testTurn(chatMatch[1] as string, chatMatch[2] as string, `echo: ${text}`) };
        };
      }
      return undefined;
    },
  }), auth);
  return { fetchMock, state, auth };
}

export function testTurn(build: string, session: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    bot: "sample", build, session, messages: [{ response: "r", text, quick_replies: [] }],
    nlu: { rule: "intent", matched_by: "exact", intents: [["greeting", 1]] }, actions: [], stack: [], ...extra,
  };
}
