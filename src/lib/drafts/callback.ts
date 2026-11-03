import { timingSafeEqual } from "node:crypto";
import type { IssueStatus } from "@/lib/types";

export function consumeCallbackToken(d: { callback_token: string; callback_used_at: string | null }, token: string): "ok" | "invalid" | "replayed" {
  const a = Buffer.from(d.callback_token); const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";
  return d.callback_used_at ? "replayed" : "ok";
}

export function prStateToStatus(action: string, merged: boolean, reviewState?: string): IssueStatus | null {
  if (action === "opened" || action === "reopened" || action === "ready_for_review") return "draft_ready";
  if (action === "submitted" && reviewState) return "in_review";
  if (action === "closed") return merged ? "shipped" : "dismissed";
  return null;
}

/** One branch per draft: the draft id suffix keeps retries and concurrent drafts from colliding. */
export function branchName(shortId: string, title: string, draftId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return `pma/${shortId}-${slug}-${draftId.slice(0, 6)}`;
}

/** Accept only the signed-upload slots minted for this exact issue/draft. */
export function validShotPath(path: unknown, issueId: string, draftId: string): boolean {
  if (typeof path !== "string") return false;
  if (!path.startsWith(`${issueId}/${draftId}/slot-`)) return false;
  return /^[0-9a-f-]+\/[0-9a-f-]+\/slot-\d{1,2}\.png$/.test(path);
}

export type Shot = { frame_id: string; path: string };
/** A Marver frame the drafter wrote: its code, so PMA can show the diff and draw the full flow from it. */
export type DraftedFrameFile = { frame_id: string; path: string; source: string; changed?: string };
export type CallbackBody = {
  draft_id: string; token: string; status: "ready" | "failed";
  pr_url?: string; pr_number?: number; marver_paths?: string[]; before?: Shot[]; after?: Shot[]; log_url?: string;
  frames?: DraftedFrameFile[];
  /** A failed draft's reason in one plain sentence (the mock runner sends it; the GitHub Action doesn't). */
  error?: string;
  /** An approximate mock-up's one line on what changed (the mock runner sends it; it has no frame files). */
  changed?: string;
  /** An approximate mock-up's proposed frame as code, kept for Download task as a layout reference (no Marver path). */
  frame_source?: string;
};

const MAX_FRAME_FILES = 8;
const MAX_FRAME_BYTES = 20_000;
/** The callback's frame files that are safe to keep: real frame paths under design/scenes/, bounded in count and size. */
export function validFrameFiles(frames: unknown): DraftedFrameFile[] {
  if (!Array.isArray(frames)) return [];
  return frames.slice(0, MAX_FRAME_FILES).filter((f): f is DraftedFrameFile =>
    !!f && typeof f === "object"
    && typeof f.frame_id === "string" && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(f.frame_id)
    && typeof f.path === "string" && f.path === `design/scenes/${f.frame_id}.tsx`
    && typeof f.source === "string" && f.source.length > 0 && f.source.length <= MAX_FRAME_BYTES
    && (f.changed === undefined || typeof f.changed === "string"))
    .map((f) => ({ frame_id: f.frame_id, path: f.path, source: f.source, ...(f.changed ? { changed: f.changed.slice(0, 300) } : {}) }));
}
/**
 * An approximate mock-up's frames entry: the design agent's one line on what changed, on the screen it drew, with no
 * Marver path, so nothing treats it as a canvas frame (no caption, no full flow). Copy task quotes the line; Download
 * task packs the proposed frame's code (`source`, when sent and within MAX_FRAME_BYTES) as a layout reference.
 */
export function approximateFrames(changed: unknown, after: { frame_id: string }[], source?: unknown): { frame_id: string; path: string; changed: string; source?: string }[] {
  const line = typeof changed === "string" ? changed.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (!line) return [];
  const id = after[0]?.frame_id;
  const code = typeof source === "string" && source.trim() && source.length <= MAX_FRAME_BYTES ? source : null;
  return [{ frame_id: typeof id === "string" && /^code\/[a-z0-9-]{1,60}$/.test(id) ? id : "code/screen", path: "", changed: line, ...(code ? { source: code } : {}) }];
}
const GITHUB_URL = /^https:\/\/github\.com\//;

/**
 * Validates the untrusted callback JSON. Shots are filtered later by validShotPath. `mockPrefix` is passed only for a
 * draft made by the mock runner, whose "pull request" is a page in this app rather than on github.com.
 */
export function parseCallbackBody(body: unknown, opts: { mockPrefix?: string } = {}): { ok: true; value: CallbackBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  const b = body as Record<string, unknown>;
  if (typeof b.draft_id !== "string" || typeof b.token !== "string") return { ok: false, error: "bad request" };
  if (b.status !== "ready" && b.status !== "failed") return { ok: false, error: "bad status" };
  const url = b.status === "ready" ? b.pr_url : b.log_url;
  const allowed = typeof url === "string" && (GITHUB_URL.test(url) || (!!opts.mockPrefix && url.startsWith(opts.mockPrefix)));
  if (!allowed) return { ok: false, error: b.status === "ready" ? "bad pr_url" : "bad log_url" };
  if (b.pr_number !== undefined && !Number.isInteger(b.pr_number)) return { ok: false, error: "bad pr_number" };
  return { ok: true, value: b as unknown as CallbackBody };
}
