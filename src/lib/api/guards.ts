// What an API route answers when the caller is in the company but not allowed to do this.
import { NextResponse } from "next/server";
import { hasRole, type AppCtx } from "@/lib/db/app";

/** The 403 for a company member who is not an owner or admin, or null when the caller may go on. Outsiders never get here: they are a 404 before the role is known. */
export function adminOnly(ctx: AppCtx): NextResponse | null {
  return hasRole(ctx, ["owner", "admin"]) ? null : NextResponse.json({ error: "Only company owners and admins can change this." }, { status: 403 });
}

/** The 404 for an app, issue or source the caller cannot see, the same answer as for one that does not exist. */
export function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
