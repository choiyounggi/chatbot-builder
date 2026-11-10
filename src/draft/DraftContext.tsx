// One working copy of the bot's draft for every editor on the bot's pages (blocks,
// entities, settings). Saving writes the whole copy with the ETag the edits started
// from, so an editor never overwrites changes another one has not saved yet, and a
// draft that changed elsewhere meanwhile is a 412, never a silent overwrite. A save
// starts a test build; the bot test panel talks to the newest one.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { getDraft, getJob, saveDraft, startTestBuild } from "../api/client";
import type { Draft, DraftSaved, Job } from "../api/types";
import { sameDoc } from "../model/blocks";
import type { BotDoc } from "../model/doc";

/** Two intents whose closest examples are very alike (engine E13), from the newest test build. */
export interface ConfusablePair {
  a: string;
  b: string;
  similarity: number;
  example_a: string;
  example_b: string;
}

export type BuildState =
  | { status: "none" }
  | { status: "building" }
  | { status: "ready"; build: string; confusable: ConfusablePair[] }
  | { status: "failed"; job: Job | null };

/** The pairs in a job result, skipping anything malformed (an older engine sends none). */
export function confusableOf(result: Record<string, unknown> | null | undefined): ConfusablePair[] {
  const raw = result?.confusable;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is ConfusablePair => !!p && typeof p === "object"
    && typeof (p as ConfusablePair).a === "string" && typeof (p as ConfusablePair).b === "string"
    && typeof (p as ConfusablePair).similarity === "number");
}

export interface DraftApi {
  botId: string;
  /** The working copy (unsaved edits included); null until the draft has loaded. */
  doc: BotDoc | null;
  query: ReturnType<typeof useDraftQuery>;
  dirty: boolean;
  /** Unsaved edits started from a revision that is no longer the stored one: saving will be refused. */
  stale: boolean;
  update: (change: (doc: BotDoc) => BotDoc) => void;
  discard: () => void;
  save: () => void;
  saving: boolean;
  saveError: unknown;
  lastSave: DraftSaved | null;
  /** Re-read the stored draft, dropping unsaved edits (after a conflict). */
  reload: () => void;
  build: BuildState;
  rebuild: () => void;
}

interface Edit {
  doc: BotDoc;
  base: string; // ETag of the stored draft these edits started from
}

const DraftContext = createContext<DraftApi | null>(null);

function useDraftQuery(botId: string) {
  return useQuery({ queryKey: ["draft", botId], queryFn: () => getDraft(botId) });
}

export function DraftProvider({ botId, children }: { botId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useDraftQuery(botId);
  const stored = query.data ?? null;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [lastSave, setLastSave] = useState<DraftSaved | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const latestBuild = useRef(0);
  const doc = edit?.doc ?? stored?.document ?? null;
  const dirty = edit !== null && !sameDoc(edit.doc, stored?.document);
  const stale = dirty && stored !== null && edit.base !== stored.etag;

  const update = useCallback((change: (doc: BotDoc) => BotDoc) => {
    setEdit((current) => {
      const base = current ?? (stored ? { doc: stored.document, base: stored.etag } : null);
      return base ? { doc: change(structuredClone(base.doc)), base: base.base } : current;
    });
  }, [stored]);

  const build = useMutation({
    mutationFn: async () => {
      const mine = ++latestBuild.current;
      return { job: await startTestBuild(botId), mine };
    },
    // only the newest request decides which job the panel follows (responses can arrive out of order)
    onSuccess: ({ job, mine }) => { if (mine === latestBuild.current) setJobId(job.id); },
  });

  const save = useMutation({
    mutationFn: async (sent: Edit) => saveDraft(botId, sent.doc, sent.base),
    onSuccess: (result, sent) => {
      setLastSave(result);
      const etag = `"${result.revision}"`;
      // what was sent is now stored: keep it even if the reload below fails
      queryClient.setQueryData<Draft>(["draft", botId], { document: sent.doc, etag });
      // edits made while saving stay unsaved, now on top of the new revision
      setEdit((current) => (current && !sameDoc(current.doc, sent.doc) ? { doc: current.doc, base: etag } : null));
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      void queryClient.invalidateQueries({ queryKey: ["draft", botId] });
      if (result.version) build.mutate(); // a draft that does not even parse cannot be built
    },
  });

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.status === "error" || (q.state.data && ["done", "failed"].includes(q.state.data.status)) ? false : 400),
  });

  const buildState = useMemo<BuildState>(() => {
    if (build.isPending || (jobId !== null && !job.isError && (!job.data || job.data.status === "queued" || job.data.status === "running"))) {
      return { status: "building" };
    }
    if (build.isError || job.isError) return { status: "failed", job: null };
    if (job.data?.status === "done" && typeof job.data.result?.build === "string") {
      return { status: "ready", build: job.data.result.build, confusable: confusableOf(job.data.result) };
    }
    if (job.data?.status === "failed") return { status: "failed", job: job.data };
    return { status: "none" };
  }, [build.isPending, build.isError, jobId, job.data, job.isError]);

  const { mutate: saveMutate, reset: saveReset, isPending: saving, error: saveError } = save;
  const { mutate: buildMutate } = build;
  const api = useMemo<DraftApi>(() => ({
    botId, doc, query, dirty, stale, update,
    discard: () => { setEdit(null); saveReset(); },
    save: () => { if (edit && !saving) saveMutate(edit); },
    saving,
    saveError,
    lastSave,
    reload: () => { setEdit(null); saveReset(); void query.refetch(); },
    build: buildState,
    rebuild: () => buildMutate(),
  }), [botId, doc, query, dirty, stale, update, edit, saving, saveMutate, saveReset, saveError, lastSave, buildState, buildMutate]);

  return <DraftContext.Provider value={api}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftApi {
  const api = useContext(DraftContext);
  if (!api) throw new Error("useDraft outside DraftProvider");
  return api;
}
