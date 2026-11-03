import { memberInviteByToken } from "@/lib/db/invites";
import { userDb } from "@/lib/db/server";
import { INVITE_MESSAGES } from "@/lib/invites";
import { InviteCard, InviteProblem } from "@/components/invite/InviteCard";
import { GitHubSignIn } from "@/components/app/GitHubSignIn";
import { joinCompany } from "./actions";
import { JoinForm } from "./JoinForm";

/**
 * A teammate's invite link. Public (the proxy lets it through): a bad link says why; signed out, it signs in with
 * GitHub and comes back here; signed in, it joins the company. The link is the invite: it works once and expires.
 */
export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [{ invite, problem }, { data: { user } }] = await Promise.all([
    memberInviteByToken(token),
    userDb().then((db) => db.auth.getUser()),
  ]);
  if (problem) return <InviteProblem message={INVITE_MESSAGES[problem]} signedIn={!!user} />;

  if (!user) {
    return (
      <InviteCard>
        <p className="text-sm text-muted-foreground">You&apos;re invited to join {invite.orgName} on PMA. Sign in with GitHub to accept.</p>
        <GitHubSignIn next={`/join/${encodeURIComponent(token)}`} />
      </InviteCard>
    );
  }

  return (
    <InviteCard title={`Join ${invite.orgName}`}>
      <p className="text-sm text-muted-foreground">You&apos;re invited to join {invite.orgName} on PMA as {user.email ?? "yourself"}.</p>
      <JoinForm action={joinCompany.bind(null, token)} orgName={invite.orgName} />
    </InviteCard>
  );
}
