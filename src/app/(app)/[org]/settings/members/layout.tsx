import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { lastAppHref } from "@/lib/db/app";

/** The company's members page sits on the stone ground on its own, without an app's sidebar, with a way back to the app. */
export default async function MembersLayout({ children }: LayoutProps<"/[org]/settings/members">) {
  const back = await lastAppHref();
  return (
    <div className="ground min-h-dvh">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:py-10">
        {back && (
          <Link href={back} className="press inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />Back to PMA
          </Link>
        )}
        <main className="rise-in rounded-2xl bg-background p-6 shadow-sheet md:p-8">{children}</main>
      </div>
    </div>
  );
}
