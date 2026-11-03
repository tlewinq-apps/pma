// src/lib/legacyRedirect.ts
// The old top-level pages (/, /work, /flows, ...) and links (/issues/<id>, /feedback/<id>, /mock/pr/<id>) from before
// every page lived under /[org]/[app]. They stay as small redirect pages: links already posted to Slack, GitHub and
// email keep working, and the person lands in the right company.
import { notFound, redirect } from "next/navigation";
import { lastAppHref, requireUser, type AppCtx } from "@/lib/db/app";
import { appHref, queryOf } from "@/lib/links";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Where a signed-in person with no company lands. It never redirects anywhere a person with no company can reach, so it cannot loop. */
export const NO_COMPANY = "/no-company";

/**
 * An old section page (path "/work", "/" for the Desk) goes to the same page in the app the person last opened, or their
 * first app, with the query it was opened with. With no app at all it goes to /no-company.
 */
export async function redirectToLastApp(path: string, sp: SearchParams, without?: string): Promise<never> {
  await requireUser(); // signed out goes to sign-in, not to /no-company
  const base = await lastAppHref();
  redirect(base ? appHref(base, path) + queryOf(sp, without) : NO_COMPANY);
}

/**
 * An old link to one thing (an issue, a source, a draft) goes to the same page in the app that owns it, keeping the
 * query. `owner` is null when the thing does not exist or sits in a company the person is not in: both are a 404, never
 * a redirect into someone else's app.
 */
export async function redirectToOwner(owner: AppCtx | null, path: string, sp: SearchParams): Promise<never> {
  if (!owner) notFound();
  redirect(appHref(owner.base, path) + queryOf(sp));
}
