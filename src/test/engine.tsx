import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AppRoutes, createQueryClient, Providers } from "../App";
import type { BotSummary } from "../api/types";

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
