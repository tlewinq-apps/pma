import { appForDraft, requireUser } from "@/lib/db/app";
import { redirectToOwner } from "@/lib/legacyRedirect";

/** The simulated pull request's old link (stored in activity and Slack messages): into the company that owns the draft. */
export default async function OldMockPullRequestLink(props: PageProps<"/mock/pr/[draftId]">) {
  const { draftId } = await props.params;
  await requireUser();
  return redirectToOwner(await appForDraft(draftId), `/mock/pr/${encodeURIComponent(draftId)}`, await props.searchParams);
}
