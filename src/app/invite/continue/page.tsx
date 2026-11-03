import { requireUser } from "@/lib/db/app";
import { liveClaimFor } from "@/lib/db/invites";
import { InviteCard } from "@/components/invite/InviteCard";
import { SignOutButton } from "@/components/app/SignOutButton";
import { CreateCompanyForm } from "../[token]/CreateCompanyForm";
import { CLAIM_MISSING } from "@/lib/invites";
import { createCompanyFromClaim } from "./actions";

/**
 * Finish setting up your company, for someone signed in with a pending company invite claim but without the link (an
 * operator's one-time sign-in link lands on /no-company, which sends them here). The claim is looked up by their own
 * sign-in email; the raw token is never needed again.
 */
export default async function ContinueInvitePage() {
  const { email } = await requireUser();
  const claim = await liveClaimFor(email);
  if (!claim) {
    return (
      <InviteCard>
        <p role="alert" className="text-sm">{CLAIM_MISSING}</p>
        <SignOutButton />
      </InviteCard>
    );
  }
  return (
    <InviteCard title="Set up your company">
      <p className="text-sm text-muted-foreground">You&apos;re invited to set up your company on PMA as {email}. Name your company and the first app you collect feedback for.</p>
      <CreateCompanyForm action={createCompanyFromClaim} />
    </InviteCard>
  );
}
