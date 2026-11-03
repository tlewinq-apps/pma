// What Build it gives Claude: the same task Copy task hands an engineer (lib/handoff/task.ts), for the approved
// proposal, then the approved mock-up's two images (today, and the change drawn over it) and its layout code when it
// has them. Read with the service role: a build runs without anyone signed in, after the route checked who started it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { parseDiagnosis } from "@/lib/diagnosis/model";
import { profileOfEmbedded } from "@/lib/product/profile";
import { buildHandoffTask, FRAME_FRAMING, IMAGES_FRAMING, pickHandoffProposal, type HandoffInput } from "@/lib/handoff/task";
import { MAX_SHOT_BYTES, shotPathOf } from "@/lib/handoff/bundle";
import type { UserContent } from "@/lib/llm/client";

const MAX_FRAME_CHARS = 20_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export type BuildProject = { id: string; org_id: string; kind: string; slug: string; name: string; repo_full_name: string | null; watched_branch: string | null; org_slug: string };
export type BuildBrief = { project: BuildProject; issue: { id: string; short_id: string; title: string }; task: string; content: UserContent; proposalTitle: string };

/** The issue, its app and the approved proposal's task and images, or null when the issue or its proposal is gone. */
export async function loadBuildBrief(issueId: string, db: SupabaseClient = serviceDb(), readShot?: (path: string) => Promise<Uint8Array | null>): Promise<BuildBrief | null> {
  const { data: i } = await db.from("issues").select(`
    id, short_id, title, problem_statement, type, diagnosis,
    projects(id, org_id, kind, slug, name, repo_full_name, watched_branch, product_profile, organizations(slug)),
    feedback_units(quote),
    solutions(id, rank, title, summary, tradeoffs, recommended),
    drafts(id, status, solution_id, before_images, after_images, frames, created_at)
  `).eq("id", issueId).maybeSingle();
  if (!i) return null;
  const x = i as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = x.projects;
  if (!p) return null;
  const draft = [...(x.drafts ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  const proposal = pickHandoffProposal(x.solutions ?? [], null, draft?.solution_id ?? null) as { id: string; title: string; summary: string; tradeoffs: string | null } | null;
  if (!proposal) return null;
  const diagnosis = parseDiagnosis(x.diagnosis);
  const finding = diagnosis?.status === "done" ? diagnosis.finding ?? null : null;
  const mine = draft && draft.solution_id === proposal.id ? draft : null;
  const frames = Array.isArray(mine?.frames) ? (mine.frames as { changed?: string; source?: unknown }[]) : [];
  const ref = finding?.source?.read ? finding.source.ref : p.repo_full_name ? p.watched_branch || null : null;
  const input: HandoffInput = {
    short_id: x.short_id, title: x.title, problem: x.problem_statement, quotes: (x.feedback_units ?? []).map((u: { quote: string }) => u.quote), type: x.type,
    finding, proposal: { title: proposal.title, summary: proposal.summary, tradeoffs: proposal.tradeoffs },
    repo: p.repo_full_name, ref, mockup: frames.some((f) => f.changed) ? { changed: frames.map((f) => f.changed).filter((c): c is string => !!c) } : null,
    profile: profileOfEmbedded(p, "build"),
  };
  const task = buildHandoffTask(input);

  // The approved mock-up: its first before and after shots, read by path from this exact draft's slots (shotPathOf).
  const read = readShot ?? (async (path: string) => {
    const { data, error } = await db.storage.from("shots").download(path);
    return error || !data ? null : new Uint8Array(await data.arrayBuffer());
  });
  const image = async (url: unknown) => {
    const path = mine?.status === "ready" ? shotPathOf(url, env.supabaseUrl(), x.id, mine.id) : null;
    const bytes = path ? await read(path).catch(() => null) : null;
    if (!bytes || bytes.length > MAX_SHOT_BYTES || !PNG_MAGIC.every((b, k) => bytes[k] === b)) return null;
    return { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: Buffer.from(bytes).toString("base64") } };
  };
  const today = await image(mine?.before_images?.[0]?.url);
  const proposed = await image(mine?.after_images?.[0]?.url);
  const frameCode = typeof frames[0]?.source === "string" ? (frames[0].source as string).slice(0, MAX_FRAME_CHARS) : null;

  const content: Exclude<UserContent, string> = [{ type: "text", text: task }];
  if (today || proposed) {
    content.push({ type: "text", text: `The approved mock-up. ${IMAGES_FRAMING}` });
    if (today) content.push({ type: "text", text: "The screen today:" }, today);
    if (proposed) content.push({ type: "text", text: "The approved change, drawn over today's screen:" }, proposed);
  }
  if (frameCode) content.push({ type: "text", text: `The mock-up's layout code: ${FRAME_FRAMING}\n\n\`\`\`tsx\n${frameCode}\n\`\`\`` });

  return {
    project: { id: p.id, org_id: p.org_id, kind: p.kind, slug: p.slug, name: p.name, repo_full_name: p.repo_full_name, watched_branch: p.watched_branch, org_slug: p.organizations?.slug ?? "" },
    issue: { id: x.id, short_id: x.short_id, title: x.title },
    task, content, proposalTitle: proposal.title,
  };
}
