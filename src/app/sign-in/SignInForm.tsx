import { BrandMark } from "@/components/app/BrandMark";
import { GitHubSignIn } from "@/components/app/GitHubSignIn";

/** Why the last sign-in didn't work, from the auth callback's ?error. */
const ERRORS: Record<string, string> = {
  link: "That sign-in didn't finish. Try again.",
};

/**
 * Signs people in with GitHub, and makes the account on the first visit: anyone may sign up, and someone in no company
 * sets one up on /no-company. `next` is the page to come back to, already checked by the sign-in page.
 */
export function SignInForm({ error, next }: { error: string | null; next: string | null }) {
  const err = error ? ERRORS[error] ?? null : null;
  return (
    <main className="ground grid min-h-dvh place-items-center px-4">
      <div className="rise-in w-full max-w-sm space-y-4 rounded-2xl bg-card p-8 shadow-pop">
        <BrandMark className="size-10" />
        <h1 className="text-3xl font-semibold">PMA</h1>
        <p className="text-sm text-muted-foreground">The Product Manager Assistant: feedback in, shipped fixes out. Sign in or create your account with GitHub.</p>
        <GitHubSignIn next={next} />
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </div>
    </main>
  );
}
