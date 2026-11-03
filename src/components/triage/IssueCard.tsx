import { ViewTransition } from "react";
import Link from "next/link";
import type { IssueCardData } from "@/lib/queries/issues";
import { IMPACT_TONE, TYPE_LABEL, flowLabel, impactLabel, initials, peopleLabel } from "./format";
import { UrgencyBadge } from "./UrgencyBadge";
import { peopleWords } from "@/lib/proposals";
import type { ProductProfile } from "@/lib/product/profile";
import { STAGE_COLOR, proposalSlot } from "./views";

// The title flies into the issue header when the card is opened, and back when you return to the Desk.
const TITLE_MORPH = { "nav-forward": "title-morph", "nav-back": "title-morph", "nav-section": "title-morph", default: "none" };
// Cards glide between the sliding row and the grid when a rail is expanded or collapsed.
const CARD_MOVE = { "rail-expand": "card-move", default: "none" };

/**
 * One issue on a rail: colour edge = type, then the title, flow, the proposal slot, and who/impact/how urgent.
 * `hot` is the Urgent rail: a warm card, and the type named in words since that rail mixes types.
 * `profile` is a customer app's own product profile: who raised it is said in its audience words, as in the issue
 * header ("1 shopper", or "1 person" before the app is described). The demo passes none and keeps "1 person".
 */
export function IssueCard({ issue, href, rail, pos, wide, hot, profile }: { issue: IssueCardData; href: string; rail: number; pos: number; wide?: boolean; hot?: boolean; profile?: ProductProfile | null }) {
  const slot = proposalSlot(issue);
  const dot = STAGE_COLOR[slot.stage];
  const impact = impactLabel(issue.severity);
  return (
    <ViewTransition name={`card-${issue.id}`} update={CARD_MOVE} default="none">
      <Link
        href={href} transitionTypes={["nav-forward"]}
        data-card-id={issue.id} data-rail={rail} data-pos={pos}
        aria-label={`${TYPE_LABEL[issue.type]}: ${issue.title}.${impact ? ` ${impact}.` : ""}${issue.urgency != null ? ` Urgency ${issue.urgency} of 10.` : ""} ${slot.label}${slot.detail ? `: ${slot.detail}` : ""}.`}
        className={`${hot ? "surface-hot" : "surface"} lift glare group flex h-[178px] shrink-0 snap-start flex-col py-3.5 pl-5 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${wide ? "w-full" : "w-[280px]"}`}
      >
        <span aria-hidden className="absolute inset-y-3.5 left-0 w-[3px] rounded-r-full" style={{ background: `var(--type-${issue.type})` }} />
        <ViewTransition name={`issue-title-${issue.id}`} share={TITLE_MORPH} default="none">
          <h3 className="line-clamp-2 font-heading text-[19px] font-semibold leading-[1.15] tracking-[-0.01em]">{issue.title}</h3>
        </ViewTransition>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {hot && <span className="mr-2 font-semibold" style={{ color: `var(--type-${issue.type})` }}>{TYPE_LABEL[issue.type]}</span>}{flowLabel(issue.flow)}
        </div>
        <div className={`mt-auto flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${dot ? "bg-muted shadow-[inset_0_1px_2px_rgb(46_43_43/0.06)]" : "border border-dashed border-foreground/20 text-muted-foreground"}`}>
          {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${slot.stage === "drafting" || slot.stage === "diagnosing" ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ background: dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${dot} 18%, transparent)` }} />}
          <span className="shrink-0 font-medium">{slot.label}</span>
          {slot.detail && <span className="truncate text-muted-foreground">{slot.detail}</span>}
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-3">
            <span className="shrink-0">{profile ? peopleWords(issue.people_count, issue.audiences, profile) : peopleLabel(issue.people_count)}</span>
            {impact && <span className={`shrink-0 font-medium ${IMPACT_TONE[Math.round(issue.severity!)]}`}>{impact}</span>}
            {issue.urgency != null && <UrgencyBadge score={issue.urgency} />}
          </span>
          {issue.owner && <span title={issue.owner.email} className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-2 ring-card">{initials(issue.owner.email)}</span>}
        </div>
      </Link>
    </ViewTransition>
  );
}
