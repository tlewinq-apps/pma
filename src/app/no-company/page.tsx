import Link from "next/link";
import { redirect } from "next/navigation";
import { lastAppHref, requireUser } from "@/lib/db/app";
import { liveClaimFor } from "@/lib/db/invites";
import { BrandMark } from "@/components/app/BrandMark";
import { SignOutButton } from "@/components/app/SignOutButton";
import { buttonVariants } from "@/components/ui/button";
import { CreateCompanyForm } from "@/app/invite/[token]/CreateCompanyForm";
import { createCompanyOpen } from "./actions";

/**
 * Where a signed-in person with no company lands. If they do have an app after all (an invite was accepted), they go
 * there instead. If they opened a company invite and asked for a sign-in link but haven't created the company yet (a
 * live claim for their address), they're offered to finish setting it up, without the link. Anyone else sets up their
 * own company here: sign-up is open, and a company set up this way runs on its own Claude key.
 */
export default async function NoCompany() {
  const { email } = await requireUser();
  const home = await lastAppHref();
  if (home) redirect(home);
  const claim = await liveClaimFor(email);
  return (
    <main className="ground grid min-h-dvh place-items-center px-4">
      <div className="rise-in w-full max-w-sm space-y-4 rounded-2xl bg-card p-8 shadow-pop">
        <BrandMark className="size-10" />
        {claim ? (
          <>
            <h1 className="text-3xl font-semibold">Finish setting up your company</h1>
            <p className="text-sm text-muted-foreground">You have an invite to set up your company on PMA. Name it and its first app, and you&apos;re in.</p>
            <Link href="/invite/continue" className={`${buttonVariants()} w-full`}>Finish setting up your company</Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">Set up your company</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re not in a company on PMA yet. Name yours and the first app you collect feedback for. You&apos;ll connect
              its repository and add your Claude API key next. Joining a teammate&apos;s company instead? Open the invite link they sent.
            </p>
            <CreateCompanyForm action={createCompanyOpen} />
          </>
        )}
        <SignOutButton />
      </div>
    </main>
  );
}
