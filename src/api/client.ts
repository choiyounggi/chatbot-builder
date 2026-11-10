import { getToken, setToken } from "./token";
import type { BotDocument, BotSummary, Draft, DraftSaved, Job, TestTurn } from "./types";

export class ApiError extends Error {
  readonly status: number;
  /** The engine's list of problems (e.g. a 422 for a document it cannot accept). */
  readonly problems: string[];
  constructor(status: number, message: string, problems: string[] = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

/** 401: the engine wants the admin token (CHATCORE_ADMIN_TOKEN). `sentToken`: one was sent and refused. */
export class AuthError extends ApiError {
  readonly sentToken: boolean;
  constructor(message: string, sentToken: boolean) {
    super(401, message);
    this.sentToken = sentToken;
  }
}

/** 412: someone saved the draft after we read it. */
export class ConflictError extends ApiError {
  readonly revision: number | null;
  constructor(revision: number | null) {
    super(412, "the draft was changed elsewhere");
    this.revision = revision;
  }
}

/** The request never got an answer from the engine (not running, wrong port). */
export class EngineUnreachable extends Error {}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) {
    try {
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      setToken(""); // unusable as a header (should not pass isValidToken): ask for it again
      throw new AuthError("the stored token cannot be sent", false);
    }
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new EngineUnreachable("the engine did not answer");
  }
  // The dev proxy answers 502/504 when nothing listens behind it.
  if (res.status === 502 || res.status === 504) throw new EngineUnreachable(`proxy ${res.status}`);
  if (res.status === 401) throw new AuthError("admin token required", token !== null);
  if (res.ok) return res;
  const body: unknown = await res.json().catch(() => null);
  const detail = body !== null && typeof body === "object" && "detail" in body ? body.detail : null;
  if (res.status === 412) {
    const revision = body !== null && typeof body === "object" && "revision" in body ? body.revision : null;
    throw new ConflictError(typeof revision === "number" ? revision : null);
  }
  // the engine sends a string, a list of problems, or {detail, errors} (e.g. a version that cannot run here)
  const inner = detail !== null && typeof detail === "object" && !Array.isArray(detail) ? detail as Record<string, unknown> : null;
  const list = Array.isArray(detail) ? detail : Array.isArray(inner?.errors) ? inner.errors : [];
  const problems = (list as unknown[]).filter((d): d is string => typeof d === "string");
  const message = typeof detail === "string" ? detail : typeof inner?.detail === "string" ? inner.detail : `HTTP ${res.status}`;
  throw new ApiError(res.status, message, problems);
}

export const bot = (id: string) => `/v1/builder/bots/${encodeURIComponent(id)}`;

export async function listBots(): Promise<BotSummary[]> {
  const res = await request("/v1/builder/bots");
  const body = (await res.json()) as { bots: BotSummary[] };
  return body.bots;
}

export async function getDraft(id: string): Promise<Draft> {
  const res = await request(`${bot(id)}/draft`);
  const etag = res.headers.get("ETag");
  if (!etag) throw new ApiError(res.status, "the engine sent a draft without an ETag");
  return { document: (await res.json()) as BotDocument, etag };
}

/** Save over the draft we read (its ETag); ConflictError when it moved on meanwhile. */
export async function saveDraft(id: string, document: BotDocument, etag: string): Promise<DraftSaved> {
  const res = await request(`${bot(id)}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": etag },
    body: JSON.stringify(document),
  });
  return (await res.json()) as DraftSaved;
}

/** Start fitting the saved draft for the test chat (a job; follow it with getJob). */
export async function startTestBuild(id: string): Promise<Job> {
  const res = await request(`${bot(id)}/test-builds`, { method: "POST" });
  return (await res.json()) as Job;
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await request(`/v1/builder/jobs/${encodeURIComponent(jobId)}`);
  return (await res.json()) as Job;
}

/** One turn with a test build. `blockId`: the user pressed a quick reply or button that starts a block
 * directly, without the engine trying to understand `text`. ApiError 410 once the build expired
 * (never the live bot), 422 if no response of the bot offers that block. */
export async function testMessage(id: string, build: string, session: string, text: string, blockId?: string): Promise<TestTurn> {
  const res = await request(`${bot(id)}/test/${encodeURIComponent(build)}/sessions/${encodeURIComponent(session)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blockId === undefined ? { text } : { text, block_id: blockId }),
  });
  return (await res.json()) as TestTurn;
}

/** The user opened the conversation: a new session answers with the welcome block's messages (maybe
 * none); an already-open session answers with none. ApiError 410 once the build expired. */
export async function testOpen(id: string, build: string, session: string): Promise<TestTurn> {
  const res = await request(`${bot(id)}/test/${encodeURIComponent(build)}/sessions/${encodeURIComponent(session)}/open`, { method: "POST" });
  return (await res.json()) as TestTurn;
}
