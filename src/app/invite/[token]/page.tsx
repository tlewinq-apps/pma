import { companyInviteByToken } from "@/lib/db/invites";
import { userDb } from "@/lib/db/server";
import { INVITE_MESSAGES } from "@/lib/invites";
import { InviteCard, InviteProblem } from "@/components/invite/InviteCard";
import { GitHubSignIn } from "@/components/app/GitHubSignIn";
import { SignOutButton } from "@/components/app/SignOutButton";
import { createCompany } from "./actions";
import { CreateCompanyForm } from "./CreateCompanyForm";

/**
 * A company invite link. Public (the proxy lets it through): a bad link says why; signed out, it signs in with GitHub
 * and comes back here; signed in (as the invite's address, when it names one), it creates the company and its first app.
 */
export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const [{ invite, problem }, { data: { user } }] = await Promise.all([
    companyInviteByToken(token),
    userDb().then((db) => db.auth.getUser()),
  ]);
  if (problem) return <InviteProblem message={INVITE_MESSAGES[problem]} signedIn={!!user} />;

  if (!user) {
    return (
      <InviteCard>
        <p className="text-sm text-muted-foreground">
          You&apos;re invited to set up your company on PMA. {invite.email ? `Sign in with the GitHub account whose email is ${invite.email}.` : "Sign in with GitHub to start."}
        </p>
        <GitHubSignIn next={`/invite/${encodeURIComponent(token)}`} />
      </InviteCard>
    );
  }

  if (invite.email && invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return (
      <InviteCard>
        <p role="alert" className="text-sm">{INVITE_MESSAGES.invite_email}</p>
        <SignOutButton to={`/invite/${encodeURIComponent(token)}`} />
      </InviteCard>
    );
  }

  return (
    <InviteCard title="Set up your company">
      <p className="text-sm text-muted-foreground">Name your company and the first app you collect feedback for.</p>
      <CreateCompanyForm action={createCompany.bind(null, token)} />
    </InviteCard>
  );
}
