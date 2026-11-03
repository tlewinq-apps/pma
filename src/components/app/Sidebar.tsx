"use client";
import { ViewTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, FolderKanban, Workflow, MessageSquarePlus, Settings, Compass, Hash, LogOut } from "lucide-react";
import { initials } from "@/components/triage/format";
import { BrandMark } from "./BrandMark";
import { inAppPath } from "@/lib/links";
import { useApp } from "./AppContext";
import { useSignOut } from "./SignOutButton";
// In-app paths; each link is href(path), inside the open app.
const NAV = [
  { path: "/", label: "Desk", icon: LayoutGrid }, { path: "/work", label: "Work", icon: FolderKanban }, { path: "/flows", label: "Flows", icon: Workflow },
  { path: "/feedback", label: "Add feedback", icon: MessageSquarePlus }, { path: "/settings", label: "Settings", icon: Settings },
];
const item = (active: boolean) => `press group relative isolate flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${active ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-white/45 hover:text-foreground"}`;
const icon = (active: boolean) => `size-4 shrink-0 transition-[color,translate] duration-300 ease-smooth ${active ? "text-brand" : "group-hover:translate-x-0.5"}`;

/** The one lit pill under the current section. It carries a view-transition name, so it glides to the next item. */
function Pill() {
  return (
    <ViewTransition name="nav-pill" share="glide" default="none">
      <span aria-hidden className="absolute inset-0 -z-10 rounded-lg bg-card shadow-[0_0_0_1px_rgb(46_43_43/0.06),0_1px_2px_rgb(46_43_43/0.06),0_4px_12px_-6px_rgb(46_43_43/0.18),inset_0_1px_0_#fff]" />
    </ViewTransition>
  );
}

export function Sidebar({ email, slackInvite }: { email: string; slackInvite: string | null }) {
  const { base, href } = useApp();
  const path = inAppPath(usePathname(), base);
  const welcome = path.startsWith("/welcome");
  const { signOut, busy, err } = useSignOut();
  return (
    <aside className="flex h-dvh w-14 shrink-0 flex-col px-2 py-3 md:w-60 md:px-3 md:py-4">
      <div className="mb-7 flex items-center gap-3 px-1.5 md:px-2">
        <BrandMark className="size-8" />
        <div className="hidden font-heading text-[24px] font-semibold leading-none tracking-[-0.02em] md:block">PMA</div>
      </div>
      <nav className="space-y-0.5">{NAV.map(({ path: to, label, icon: Icon }) => {
        const active = to === "/" ? path === "/" || path.startsWith("/issues/") : path.startsWith(to);
        return (
          <Link key={to} href={href(to)} title={label} transitionTypes={["nav-section"]} aria-current={active ? "page" : undefined} className={item(active)}>
            {active && <Pill />}
            <Icon className={icon(active)} /><span className="sr-only md:not-sr-only">{label}</span>
          </Link>
        );
      })}</nav>
      <div className="mt-auto space-y-0.5">
        <Link href={href("/welcome")} title="Start here" transitionTypes={["nav-section"]} aria-current={welcome ? "page" : undefined} className={item(welcome)}>
          {welcome && <Pill />}
          <Compass className={icon(welcome)} /><span className="sr-only md:not-sr-only">Start here</span>
        </Link>
        {slackInvite && <a href={slackInvite} target="_blank" rel="noreferrer" title="Join Slack" data-tour="join-slack-nav" className={item(false)}><Hash className={icon(false)} /><span className="sr-only md:not-sr-only">Join Slack</span></a>}
        {email && (
          <div title={email} className="mt-3 flex items-center gap-2.5 border-t border-foreground/10 px-1 pt-3 md:px-1.5">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-card text-[10px] font-semibold text-foreground shadow-paper">{initials(email)}</span>
            <span className="hidden truncate text-xs text-muted-foreground md:block">{email}</span>
          </div>
        )}
        {/* Sign out from any page: ends this browser's session and lands on the sign-in page. */}
        <button type="button" onClick={signOut} disabled={busy} title="Sign out" className={`${item(false)} w-full disabled:opacity-60`}>
          <LogOut aria-hidden className={icon(false)} /><span className="sr-only md:not-sr-only">{busy ? "Signing out" : "Sign out"}</span>
        </button>
        {err && <p role="alert" className="sr-only px-2.5 text-xs text-destructive md:not-sr-only">{err}</p>}
      </div>
    </aside>
  );
}
