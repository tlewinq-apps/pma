import Link from "next/link";
import { BrandMark } from "@/components/app/BrandMark";

/** The card the invite and join pages sit in: the same floating card as sign-in and /no-company. */
export function InviteCard({ title = "PMA", children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="ground grid min-h-dvh place-items-center px-4">
      <div className="rise-in w-full max-w-sm space-y-4 rounded-2xl bg-card p-8 shadow-pop">
        <BrandMark className="size-10" />
        <h1 className="text-3xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Why the link can't be used, plus a way into PMA for someone already signed in. */
export function InviteProblem({ message, signedIn }: { message: string; signedIn: boolean }) {
  return (
    <InviteCard>
      <p role="alert" className="text-sm">{message}</p>
      {signedIn && <Link href="/" className="text-sm font-medium underline underline-offset-4">Open PMA</Link>}
    </InviteCard>
  );
}
