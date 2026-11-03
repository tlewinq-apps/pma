"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";

/** Signs out in the browser, then goes to `to`; `err` says so in words when Supabase refuses. Shared by every Sign out. */
export function useSignOut(to = "/sign-in") {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function signOut() {
    setBusy(true); setErr(null);
    const db = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await db.auth.signOut();
    if (error) { setErr("Could not sign out. Try again."); setBusy(false); return; }
    router.replace(to);
    router.refresh();
  }
  return { signOut, busy, err };
}

/** Signs out in the browser, then goes to `to` (the sign-in page unless told otherwise, e.g. back to an invite link). */
export function SignOutButton({ to = "/sign-in" }: { to?: string }) {
  const { signOut, busy, err } = useSignOut(to);
  return (
    <>
      <Button variant="outline" className="w-full" onClick={signOut} disabled={busy}>Sign out</Button>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </>
  );
}
