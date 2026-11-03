// PMA's OAuth client for PostHog, as a Client ID Metadata Document. PostHog fetches this URL (it is the client_id)
// during "Sign in with PostHog". It is built from APP_URL at request time because the document's client_id and
// redirect URL must be this deployment's own; a static file under public/ would have to name one deployment for all.
import { NextResponse, connection } from "next/server";
import { posthogClientMetadata } from "@/lib/posthog/oauth";

export async function GET() {
  await connection();
  return NextResponse.json(posthogClientMetadata(), { headers: { "cache-control": "public, max-age=300" } });
}
