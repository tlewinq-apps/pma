// Copy task for Claude Code: the issue's chosen proposal as a markdown task (lib/handoff/task.ts). Anyone in the
// company can read it; an issue outside the caller's company is a 404. ?solution=<id> picks the proposal (else the
// mocked-up one, else the recommended one); ?download=1 sends it as a .md file; ?format=zip sends Download task, a .zip
// with task.md and the approved mock-up's images and layout code (lib/handoff/bundle.ts).
//
// POST records that someone handed the task off (copied it, or downloaded it), so the issue can say it is waiting for
// the pull request. Any member may; repeated clicks by the same person within ten minutes are recorded once, but the
// window never reaches back past the latest approval, so the first hand-off after an approval always counts.
import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { serviceDb, userDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { getIssueDetail } from "@/lib/queries/issueDetail";
import { buildHandoffTask, handoffFilename, handoffInputFor, pickHandoffProposal } from "@/lib/handoff/task";
import { buildHandoffZip } from "@/lib/handoff/bundle";

export const maxDuration = 30;
const REPEAT_MS = 10 * 60_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const d = await getIssueDetail(id); // RLS-scoped
  if (!d) return notFoundResponse();

  const url = new URL(req.url);
  const proposal = pickHandoffProposal(d.solutions, url.searchParams.get("solution"), d.draft?.solution_id ?? null);
  if (!proposal) return NextResponse.json({ error: "Write or pick a proposal first." }, { status: 409 });

  const task = handoffInputFor(d, ctx.project, proposal);
  // The mock-up of this proposal, when it has one.
  const draft = d.draft && d.draft.solution_id === proposal.id ? d.draft : null;

  if (url.searchParams.get("format") === "zip") {
    // A finished mock-up's shots and layout code; the frame code is read here (the page's query leaves it out).
    let frames: { source?: unknown }[] = [];
    if (draft?.status === "ready") {
      const { data } = await (await userDb()).from("drafts").select("frames").eq("id", draft.id).maybeSingle(); // RLS-scoped
      frames = Array.isArray(data?.frames) ? (data.frames as { source?: unknown }[]) : [];
    }
    const body = await buildHandoffZip({
      task, issueId: d.id, supabaseUrl: env.supabaseUrl(),
      draft: draft?.status === "ready" ? { id: draft.id, before: draft.before ?? [], after: draft.after ?? [], frames } : null,
      // The path is already checked to be one of this draft's slots (shotPathOf), and the issue is the caller's.
      readShot: async (path) => {
        const { data, error } = await serviceDb().storage.from("shots").download(path);
        return error || !data ? null : new Uint8Array(await data.arrayBuffer());
      },
    });
    return new NextResponse(new Uint8Array(body), { headers: {
      "content-type": "application/zip", "cache-control": "no-store",
      "content-disposition": `attachment; filename="${handoffFilename(d.short_id, "zip")}"`,
    } });
  }

  const md = buildHandoffTask(task);
  const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" };
  if (url.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename="${handoffFilename(d.short_id)}"`;
  return new NextResponse(md, { headers });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const body = (await req.json().catch(() => null)) as { via?: unknown; solution?: unknown } | null;
  const via = body?.via === "download" ? "download" : body?.via === "copy" ? "copy" : null;
  if (!via) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const db = await userDb(); // RLS: activity on an issue in the caller's company
  const { data: approval } = await db.from("activity").select("at").eq("issue_id", id).eq("kind", "approved").order("at", { ascending: false }).limit(1).maybeSingle();
  const window = new Date(Date.now() - REPEAT_MS).toISOString();
  const approvedAt = typeof approval?.at === "string" ? approval.at : null;
  const since = approvedAt && approvedAt > window ? approvedAt : window;
  const { data: recent } = await db.from("activity").select("id").eq("issue_id", id).eq("kind", "handed_off").eq("user_id", ctx.userId).gte("at", since).limit(1);
  if (recent?.length) return NextResponse.json({ ok: true, repeated: true });
  const solution = typeof body?.solution === "string" && /^[0-9a-f-]{36}$/i.test(body.solution) ? body.solution : null;
  const { error } = await db.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "handed_off", payload: { via, to: "claude_code", ...(solution ? { solution_id: solution } : {}) } });
  if (error) return NextResponse.json({ error: "Couldn't record that. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
