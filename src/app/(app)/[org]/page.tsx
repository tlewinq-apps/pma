import { notFound, redirect } from "next/navigation";
import { myApps, requireUser } from "@/lib/db/app";
import { appBase, queryOf } from "@/lib/links";

/** /<company>: the company's first app, if the person is in the company. Otherwise a 404, the same as for a company that does not exist. */
export default async function CompanyPage(props: PageProps<"/[org]">) {
  const { org } = await props.params;
  const sp = await props.searchParams;
  await requireUser();
  // myApps only holds apps in companies the person belongs to, ordered by company slug then app slug. Slugs are
  // case-insensitive in the database, so the comparison is too; the redirect uses the stored spelling.
  const first = (await myApps()).find((a) => a.org.slug.toLowerCase() === org.toLowerCase());
  if (!first) notFound();
  redirect(appBase(first.org.slug, first.app.slug) + queryOf(sp));
}
