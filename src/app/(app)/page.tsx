import { redirect } from "next/navigation";
import { requireUser } from "@/lib/db/app";
import { queryOf } from "@/lib/links";
import { redirectToLastApp } from "@/lib/legacyRedirect";

/** "Open PMA": the Desk of the app the person last opened, or of their first app, or /no-company. */
export default async function Home(props: PageProps<"/">) {
  const sp = await props.searchParams;
  await requireUser();
  // Old deep links (Slack, PR bodies) used /?issue=<id>; the old issue link then finds the company that owns it.
  if (typeof sp.issue === "string") redirect(`/issues/${encodeURIComponent(sp.issue)}${queryOf(sp, "issue")}`);
  return redirectToLastApp("/", sp);
}
