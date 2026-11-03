import { appForSource, requireUser } from "@/lib/db/app";
import { redirectToOwner } from "@/lib/legacyRedirect";

/** An old link to one piece of feedback: into the company that owns it. */
export default async function OldFeedbackLink(props: PageProps<"/feedback/[id]">) {
  const { id } = await props.params;
  await requireUser();
  return redirectToOwner(await appForSource(id), `/feedback/${encodeURIComponent(id)}`, await props.searchParams);
}
