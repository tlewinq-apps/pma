"use client";
import { useActionState, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyLink, copyText } from "@/components/invite/CopyLink";
import type { Role } from "@/lib/db/app";
import { changeRole, inviteTeammate, removeMember, revokeMemberInvite, rotateMemberInvite } from "./actions";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/**
 * One member. Owners get a role select and Remove (with a confirm step); everyone else sees the email and role. A
 * refused change (the last owner, say) is shown under the row and the select goes back to the role it had.
 */
export function MemberRow({ orgId, orgName, userId, email, role, isSelf, canManage }: {
  orgId: string; orgName: string; userId: string; email: string; role: Role; isSelf: boolean; canManage: boolean;
}) {
  const [shown, setShown] = useState<Role>(role);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const setRole = (next: Role) => {
    setShown(next);
    setError(null);
    start(async () => {
      const r = await changeRole(orgId, userId, next);
      if (r) { setShown(role); setError(r.error); }
    });
  };
  const remove = () => start(async () => {
    setError(null);
    const r = await removeMember(orgId, userId);
    if (r) { setError(r.error); setConfirming(false); }
  });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="min-w-0 flex-1 truncate">
        {email}
        {isSelf && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">You</span>}
      </span>
      {canManage ? (
        <select aria-label={`Role for ${email}`} value={shown} disabled={busy} onChange={(e) => setRole(e.target.value as Role)}
          className="field h-8 px-2 text-sm outline-none disabled:opacity-60">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      ) : (
        <span className="text-muted-foreground">{ROLE_LABEL[role]}</span>
      )}
      {canManage && !confirming && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setConfirming(true); }}>Remove</Button>
      )}
      {canManage && confirming && (
        <div className="flex basis-full flex-wrap items-center justify-end gap-2 rise-in">
          <span className="text-muted-foreground">
            {isSelf ? `Leave ${orgName}? You'll lose access to its apps.` : `Remove ${email}? They'll lose access to ${orgName}'s apps.`}
          </span>
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Yes, remove"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      )}
      {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
    </li>
  );
}

/**
 * A pending invite. Its link can't be shown again (only a hash is stored), so Copy new link replaces it and copies the
 * new one; Revoke withdraws it.
 */
export function InviteRow({ orgId, id, email, role, expires }: {
  orgId: string; id: string; email: string; role: "admin" | "member"; expires: string | null;
}) {
  const [fresh, setFresh] = useState<{ link: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const rotate = () => start(async () => {
    setError(null);
    const r = await rotateMemberInvite(orgId, id);
    if ("error" in r) { setError(r.error); return; }
    setFresh({ link: r.link, copied: await copyText(r.link) });
  });
  const revoke = () => start(async () => {
    setError(null);
    const r = await revokeMemberInvite(orgId, id);
    if (r) setError(r.error);
  });

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 truncate">{email}</span>
        <span className="text-muted-foreground">{ROLE_LABEL[role]}</span>
        <span className="text-muted-foreground">{expires ? `Expires ${expires}` : "Expired"}</span>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={rotate}>Copy new link</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={revoke}>Revoke</Button>
      </div>
      {fresh && (
        <div className="space-y-1.5 rise-in">
          <p role="status">{fresh.copied ? "New link copied. The old link no longer works." : "Here's the new link. The old link no longer works."}</p>
          <CopyLink link={fresh.link} label="New invite link" />
        </div>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </li>
  );
}

type InviteState = { email: string; role: "admin" | "member"; link: string } | { error: string } | null;

/** Invite a teammate as a member or an admin: PMA makes a one-time link to copy and send. The email is a label for the pending list. */
export function InviteForm({ orgId }: { orgId: string }) {
  const id = useId();
  const [state, submit, pending] = useActionState<InviteState, FormData>(async (_prev, form) => {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = form.get("role") === "admin" ? "admin" : "member";
    const r = await inviteTeammate(orgId, email, role);
    return "error" in r ? r : { email, role, ...r };
  }, null);
  return (
    <div className="space-y-4 surface p-5 text-sm">
      <form action={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor={`${id}-email`} className="block font-medium">Email</label>
          <Input id={`${id}-email`} name="email" type="email" required maxLength={254} placeholder="name@company.com" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-role`} className="block font-medium">Role</label>
          <select id={`${id}-role`} name="role" defaultValue="member" className="field block h-9 w-32 px-2.5 outline-none">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Making the link…" : "Make invite link"}</Button>
      </form>
      {state && "error" in state && <p role="alert" className="text-destructive">{state.error}</p>}
      {state && "link" in state && (
        <div className="space-y-2 rise-in">
          <p role="status">Send this link to {state.email}. Whoever opens it first and signs in with GitHub joins as {state.role === "admin" ? "an admin" : "a member"}. It works once and expires in 7 days.</p>
          <CopyLink link={state.link} />
        </div>
      )}
    </div>
  );
}
