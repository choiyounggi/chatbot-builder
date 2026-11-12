// Create, delete and restore bots (builder bot list, B7).
import { bot, request } from "./client";
import type { components } from "./schema";

type S = components["schemas"];

export type BotCreated = S["BotCreatedOut"];
export type BotDeleted = S["BotDeletedOut"];
export type BotRestored = S["BotRestoredOut"];

/** A new draft bot: empty, or (with copyFrom) a copy of another bot's draft. ApiError 409 when the id
 * exists or is waiting for deletion, 404 when copyFrom has no draft or is waiting for deletion, 422 bad
 * id/label. */
export async function createBot(id: string, label: string, copyFrom?: string): Promise<BotCreated> {
  const res = await request("/v1/builder/bots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(copyFrom === undefined ? { id, label } : { id, label, copy_from: copyFrom }),
  });
  return (await res.json()) as BotCreated;
}

/** Stops the bot answering users at once; purged after `purge_after` unless restored. ApiError 409
 * when already waiting, 404 unknown. */
export async function deleteBot(id: string): Promise<BotDeleted> {
  const res = await request(bot(id), { method: "DELETE" });
  return (await res.json()) as BotDeleted;
}

/** ApiError 404 when no deletion is pending. */
export async function restoreBot(id: string): Promise<BotRestored> {
  const res = await request(`${bot(id)}/restore`, { method: "POST" });
  return (await res.json()) as BotRestored;
}
