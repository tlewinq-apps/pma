import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { lastAppHref, requireUser } from "@/lib/db/app";
import { serviceDb, userDb } from "@/lib/db/server";
import { BrandMark } from "@/components/app/BrandMark";
import { CreateInviteForm, RevokeInviteButton } from "./AdminControls";

type Summary = { name: string; slug: string; created_at: string; members: number; apps: number };
type PendingInvite = { id: string; email: string | null; note: string | null; created_at: string; expires_at: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * PMA's platform admin page: every company with counts only, the company invite links still waiting to be used, and
 * a form that makes a new one. Anyone who is not a platform admin gets a 404. It never shows member emails, links into
 * a company, or any link except the one just made.
 */
export default async function AdminPage() {
  await requireUser();
  const db = await userDb();
  const { data: isAdmin, error: checkError } = await db.rpc("is_platform_admin");
  if (checkError) throw new Error(`platform admin check failed: ${checkError.message}`);
  if (isAdmin !== true) notFound();

  const [summaries, invites, back] = await Promise.all([
    db.rpc("admin_company_summaries"),
    // company_invites has no grants for signed-in users; read only after the check above. Never the token hash.
    serviceDb()
      .from("company_invites")
      .select("id, email, note, created_at, expires_at")
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    lastAppHref(),
  ]);
  if (summaries.error) throw new Error(`company summaries failed: ${summaries.error.message}`);
  if (invites.error) throw new Error(`company invites failed: ${invites.error.message}`);
  const companies = (summaries.data ?? []) as Summary[];
  const pending = (invites.data ?? []) as PendingInvite[];

  return (
    <div className="ground min-h-dvh">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:py-10">
        {back && (
          <Link href={back} className="press inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />Back to PMA
          </Link>
        )}
        <main className="rise-in space-y-8 rounded-2xl bg-background p-6 shadow-sheet md:p-8">
          <header className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <h1 className="text-3xl font-semibold">PMA admin</h1>
              <p className="text-sm text-muted-foreground">Invite companies to PMA. You see each company&apos;s size, never what&apos;s inside it.</p>
            </div>
          </header>

          <section aria-labelledby="companies" className="space-y-3">
            <h2 id="companies" className="text-lg font-semibold">Companies</h2>
            <div className="overflow-x-auto surface">
              <table aria-labelledby="companies" className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">In links</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 text-right font-medium">Members</th>
                    <th className="px-4 py-2.5 text-right font-medium">Apps</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-muted-foreground">No companies yet.</td></tr>}
                  {companies.map((c) => (
                    <tr key={c.slug} className="border-t border-border/60">
                      <td className="px-4 py-2.5 font-medium">{c.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.slug}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{day(c.created_at)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.members}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.apps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="pending" className="space-y-3">
            <div>
              <h2 id="pending" className="text-lg font-semibold">Pending invite links</h2>
              <p className="text-sm text-muted-foreground">Links nobody has used yet. Revoke one and it stops working straight away.</p>
            </div>
            <div className="overflow-x-auto surface">
              <table aria-labelledby="pending" className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Who can use it</th>
                    <th className="px-4 py-2.5 font-medium">Note</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                    <th className="px-4 py-2.5 font-medium">Expires</th>
                    <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-muted-foreground">No pending invite links.</td></tr>}
                  {pending.map((i) => (
                    <tr key={i.id} className="border-t border-border/60 align-top">
                      <td className="px-4 py-2.5">{i.email ?? <span className="text-muted-foreground">Anyone with the link</span>}</td>
                      <td className="max-w-64 px-4 py-2.5 break-words">{i.note ?? <span className="text-muted-foreground">No note</span>}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{day(i.created_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{day(i.expires_at)}</td>
                      <td className="px-4 py-2 text-right"><RevokeInviteButton id={i.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="create" className="space-y-3">
            <div>
              <h2 id="create" className="text-lg font-semibold">Create invite link</h2>
              <p className="text-sm text-muted-foreground">Whoever opens the link sets up a new company and becomes its owner.</p>
            </div>
            <CreateInviteForm />
          </section>
        </main>
      </div>
    </div>
  );
}
