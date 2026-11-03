"use client";
import { useActionState, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyLink } from "@/components/invite/CopyLink";
import { createCompanyInvite, revokeCompanyInvite, type InviteDays } from "./actions";

type CreateState = { link: string } | { error: string } | null;

const DAYS: { value: InviteDays; label: string }[] = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
];

/** The "Create invite link" form. The link it gets back is shown here once; only its hash is stored. */
export function CreateInviteForm() {
  const id = useId();
  const [state, submit, pending] = useActionState<CreateState, FormData>(async (_prev, form) => createCompanyInvite({
    email: String(form.get("email") ?? ""),
    note: String(form.get("note") ?? ""),
    days: Number(form.get("days")) as InviteDays,
  }), null);
  return (
    <div className="space-y-4 surface p-5 text-sm">
      <form action={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-email`} className="block font-medium">Email</label>
            <Input id={`${id}-email`} name="email" type="email" maxLength={254} placeholder="name@company.com" aria-describedby={`${id}-email-hint`} />
            <p id={`${id}-email-hint`} className="text-xs text-muted-foreground">Optional. Only this address can use the link. Leave it empty for anyone who has the link.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-note`} className="block font-medium">Note</label>
            <Input id={`${id}-note`} name="note" maxLength={200} placeholder="Who it's for" aria-describedby={`${id}-note-hint`} />
            <p id={`${id}-note-hint`} className="text-xs text-muted-foreground">Optional. Who the link is for. Only platform admins see it.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-days`} className="block font-medium">Expires after</label>
            <select id={`${id}-days`} name="days" defaultValue="7" className="field block h-9 w-36 px-2.5 outline-none">
              {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <Button type="submit" size="lg" disabled={pending}>{pending ? "Creating…" : "Create invite link"}</Button>
        </div>
      </form>
      {state && "error" in state && <p role="alert" className="text-destructive">{state.error}</p>}
      {state && "link" in state && (
        <div className="space-y-2 rise-in">
          <p role="status" className="font-medium">Copy this link now. It won&apos;t be shown again.</p>
          <CopyLink link={state.link} />
        </div>
      )}
    </div>
  );
}

/** Revoke on a pending company invite: its link stops working at once. */
export function RevokeInviteButton({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => start(async () => {
        const r = await revokeCompanyInvite(id);
        setError(r?.error ?? null);
      })}>{busy ? "Revoking…" : "Revoke"}</Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
