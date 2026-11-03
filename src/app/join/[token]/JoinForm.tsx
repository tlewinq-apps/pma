"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";

/** Signed in on a member invite: one button that joins the company. */
export function JoinForm({ action, orgName }: { action: () => Promise<{ error: string } | null>; orgName: string }) {
  const [state, submit, pending] = useActionState<{ error: string } | null, FormData>(async () => action(), null);
  return (
    <form action={submit} className="space-y-4">
      <Button className="w-full" type="submit" disabled={pending}>{pending ? "Joining…" : `Join ${orgName}`}</Button>
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
