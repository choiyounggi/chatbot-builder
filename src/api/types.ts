// Response shapes of the engine's builder API, from its OpenAPI schema
// (`npm run gen:api` regenerates src/api/schema.d.ts from chatbot-engine docs/openapi.json).
import type { BotDoc } from "../model/doc";
import type { components } from "./schema";

type S = components["schemas"];

export type BotSummary = S["BotSummaryOut"];
export type DraftSaved = S["DraftSavedOut"];
export type Job = S["JobOut"];
export type TestTurn = S["TestTurnOut"];
export type BotDocument = BotDoc;

export interface Draft {
  document: BotDoc;
  etag: string;
}
