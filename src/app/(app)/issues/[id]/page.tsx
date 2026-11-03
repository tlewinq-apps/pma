import { appForIssue, requireUser } from "@/lib/db/app";
import { redirectToOwner } from "@/lib/legacyRedirect";

/** The permanent short link to an issue (Slack, email and PR links use it): into the company that owns the issue. */
export default async function OldIssueLink(props: PageProps<"/issues/[id]">) {
  const { id } = await props.params;
  await requireUser();
  return redirectToOwner(await appForIssue(id), `/issues/${encodeURIComponent(id)}`, await props.searchParams);
}
