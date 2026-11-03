// The app's product profile (lib/product/profile.ts), which every prompt about its feedback is written from. POST drafts
// it from the connected repository and saves it; PATCH saves the fields as the owner edited them (name, one-liner and
// platform; the audience words drafted from the repository are kept, never shown in the editor). Owners and admins
// only. product_profile has no UPDATE grant for signed-in users (0022), so the write goes through the service role, and
// only after the membership and role checks above it. The demo app's profile is fixed (profileOf ignores the column).
import { NextResponse } from "next/server";
import { appById, type AppCtx } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { callStructured, claudeReady, withAppClaude } from "@/lib/llm/client";
import { friendlyLlmError } from "@/lib/llm/errors";
import { profileEdit, profileFromRepo } from "@/lib/product/fromRepo";
import { GENERIC_PROFILE, parseProfile, type ProductProfile } from "@/lib/product/profile";
import { openRepo, REPO_MESSAGES, RepoFetchError, RepoPathError, unreadableReason } from "@/lib/repo/snapshot";

// Reading a large public repository downloads and unpacks its tarball before the model call.
export const maxDuration = 60;

const bad = (error: string, status = 400, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

/** The app, if the caller is an owner or admin of its company and it isn't the demo; otherwise the answer to send. */
async function editable(appId: string): Promise<{ ctx: AppCtx } | { res: NextResponse }> {
  const ctx = await appById(appId);
  if (!ctx) return { res: notFoundResponse() };
  const denied = adminOnly(ctx);
  if (denied) return { res: denied };
  if (ctx.project.kind === "demo") return { res: bad("The demo app's product description is fixed.") };
  return { ctx };
}

async function save(ctx: AppCtx, profile: ProductProfile): Promise<NextResponse> {
  const { error } = await serviceDb().from("projects").update({ product_profile: profile }).eq("id", ctx.project.id);
  return error ? bad("Couldn't save the description. Try again.", 500) : NextResponse.json({ ok: true, profile });
}

export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const { ctx } = r;
  if (!ctx.project.repo_full_name) return bad("Connect your repository first, or fill in the fields yourself.");
  // Reading the repository runs on the company's own Claude key.
  return withAppClaude(ctx.project.id, () => draftProfile(ctx));
}

async function draftProfile(ctx: AppCtx): Promise<NextResponse> {
  if (!claudeReady()) return bad("PMA needs a Claude key to read your repository. Add your Claude API key on Start here, or fill in the fields yourself.", 503);

  let snap;
  try {
    snap = await openRepo(ctx.project);
    if (!snap) return bad(REPO_MESSAGES[await unreadableReason(ctx.project.repo_full_name!, { orgId: ctx.project.org_id })]);
  } catch (e) {
    if (e instanceof RepoFetchError) return bad(e.message, 502);
    if (e instanceof RepoPathError) return bad(e.message);
    throw e;
  }

  let profile: ProductProfile;
  try {
    profile = await profileFromRepo(snap, callStructured);
  } catch (e) {
    console.error("[profile] couldn't draft from the repository", ctx.project.id, e instanceof Error ? e.message : e);
    return bad(friendlyLlmError(e), 502);
  }
  return save(ctx, profile);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  // The editor doesn't send the audience words: the saved ones (drafted from the repository) stay, else the generic ones.
  const checked = profileEdit(await req.json().catch(() => null), parseProfile(r.ctx.project.product_profile) ?? GENERIC_PROFILE);
  if (!checked.ok) return bad("Fix the fields marked below, then save.", 400, { fields: checked.fields });
  return save(r.ctx, checked.profile);
}
