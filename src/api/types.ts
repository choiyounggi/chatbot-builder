// Response shapes of the engine's builder API (chatbot-engine src/chatcore/api.py).
// Hand-written for now: the engine declares most responses as `Any`, so generated
// OpenAPI types would be empty. Switch to generated types once the engine has
// response models (see docs/builder-plan.md, B1 notes).

export interface BotSummary {
  id: string;
  label: string;
  live: string | null; // deployed version (12-hex content hash)
  live_number: number | null; // v1, v2, ...
  serving: string | null; // version this engine process answers with
  draft_revision: number | null;
  undeployed_changes: boolean;
}

export type BotDocument = Record<string, unknown> & { id: string; label?: string };

export interface Draft {
  document: BotDocument;
  etag: string;
}

export interface DraftSaved {
  bot: string;
  version: string | null;
  revision: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
}
