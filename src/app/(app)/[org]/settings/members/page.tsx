import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, type Role } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { InviteForm, InviteRow, MemberRow } from "./MemberControls";

type Member = { user_id: string; email: string; role: Role };
type Invite = { id: string; email: string; role: "admin" | "member"; expires: string | null };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The company's invites nobody has accepted or withdrawn, newest first; `expires` is null once one has expired. */
async function pendingInvites(db: SupabaseClient, orgId: string): Promise<Invite[]> {
  const { data, error } = await db
    .from("member_invites")
    .select("id, email, role, expires_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`invite list failed: ${error.message}`);
  const now = Date.now();
  return (data ?? []).map((i) => ({
    id: i.id as string, email: i.email as string, role: i.role as Invite["role"],
    expires: Date.parse(i.expires_at as string) <= now ? null : day(i.expires_at as string),
  }));
}

/**
 * A company's members, for everyone in it. Owners change roles and remove people; owners and admins invite people and
 * manage pending invites; members see the list. Anyone outside the company (a platform admin included) gets a 404.
 */
export default async function MembersPage(props: PageProps<"/[org]/settings/members">) {
  const { org: orgSlug } = await props.params;
  const { userId } = await requireUser();
  const db = await userDb();
  // RLS shows a company only to its members; slugs are citext, so this ignores case.
  const { data: org, error } = await db.from("organizations").select("id, name").eq("slug", orgSlug).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`company lookup failed: ${error.message}`);
  if (!org) notFound();

  const list = await db.rpc("org_member_list", { p_org: org.id });
  if (list.error) throw new Error(`member list failed: ${list.error.message}`);
  const members = (list.data ?? []) as Member[];
  const me = members.find((m) => m.user_id === userId);
  if (!me) notFound();
  const isOwner = me.role === "owner";
  const canInvite = me.role === "owner" || me.role === "admin";

  // member_invites is readable by the company's owners and admins only.
  const invites = canInvite ? await pendingInvites(db, org.id) : [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Company members</h1>
        <p className="text-sm text-muted-foreground">
          Everyone in {org.name} can open all of its apps. Owners manage members and roles, admins invite people and
          change app settings, and members use the apps.
        </p>
      </header>

      <section aria-labelledby="members-heading" className="space-y-3">
        <h2 id="members-heading" className="text-lg font-semibold">Members</h2>
        <ul className="divide-y divide-border/60 surface text-sm">
          {members.map((m) => (
            <MemberRow key={`${m.user_id}:${m.role}`} orgId={org.id} orgName={org.name} userId={m.user_id} email={m.email} role={m.role}
              isSelf={m.user_id === userId} canManage={isOwner} />
          ))}
        </ul>
      </section>

      {canInvite && (
        <section aria-labelledby="pending-heading" className="space-y-3">
          <div>
            <h2 id="pending-heading" className="text-lg font-semibold">Pending invites</h2>
            <p className="text-sm text-muted-foreground">Links are shown only once. Copy new link makes a fresh one and the old link stops working.</p>
          </div>
          {invites.length === 0
            ? <p className="text-sm text-muted-foreground">No pending invites.</p>
            : (
              <ul className="divide-y divide-border/60 surface text-sm">
                {invites.map((i) => (
                  <InviteRow key={i.id} orgId={org.id} id={i.id} email={i.email} role={i.role} expires={i.expires} />
                ))}
              </ul>
            )}
        </section>
      )}

      {canInvite && (
        <section aria-labelledby="invite-heading" className="space-y-3">
          <div>
            <h2 id="invite-heading" className="text-lg font-semibold">Invite a teammate</h2>
            <p className="text-sm text-muted-foreground">They get a link that works once, for their address, for 7 days.</p>
          </div>
          <InviteForm orgId={org.id} />
        </section>
      )}
    </div>
  );
}
