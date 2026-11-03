"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, Minus } from "lucide-react";
import { nextTourState, tourCard, TOUR_LENGTH, type TourAction, type TourStage } from "@/lib/tour/steps";
import { inAppPath } from "@/lib/links";
import { parseTour, subscribeTour, tourSnapshot, writeTour } from "./tourStore";
import { useApp } from "./AppContext";

// The page tells the tour where things stand through data attributes (Workspace's data-tour-stage, data-tour on the
// buttons), so the tour reads the DOM instead of reaching into each page. Layout shifts don't always mutate the DOM,
// so the outline's position is re-read every frame while there is something to outline.
function subscribeDom(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tour-stage", "data-tour-issue", "data-tour-mockup", "data-slot"] });
  return () => mo.disconnect();
}
function subscribeFrames(cb: () => void) {
  let id = requestAnimationFrame(function loop() { cb(); id = requestAnimationFrame(loop); });
  return () => cancelAnimationFrame(id);
}
const noFrames = () => () => {};

/** The first of these selectors that is on screen. */
function findTarget(selectors: string[]): HTMLElement | null {
  for (const s of selectors) {
    for (const el of document.querySelectorAll<HTMLElement>(s)) if (el.getClientRects().length > 0) return el;
  }
  return null;
}

// The card sits above the in-app feedback widget's button (public/widget.js), which takes the bottom 54px on the right.
const CARD_W = 340, CARD_H = 280, GAP = 24, BOTTOM = 72;
const primaryClass = "inline-flex h-10 items-center gap-2 btn-ink sheen px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
const quietClass = "text-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60";

/**
 * The welcome tour: a card that walks one real issue from the Desk to shipped, outlining the real button for each
 * step and moving on when it's pressed. Started from Start here (TourStart); the steps live in lib/tour/steps.ts.
 */
export function Tour({ hasInvite, email, audience }: { hasInvite: boolean; email: string | null; audience?: { one: string; many: string } }) {
  const { base, api } = useApp();
  const slackUrl = api("/tour/slack");
  const path = inAppPath(usePathname(), base);
  const raw = useSyncExternalStore(subscribeTour, tourSnapshot, () => "");
  const state = useMemo(() => parseTour(raw), [raw]);
  const active = state?.status === "active";
  const issueId = active ? state.issueId : null;

  const readStage = () => (issueId ? document.querySelector(`[data-tour-issue="${CSS.escape(issueId)}"]`)?.getAttribute("data-tour-stage") ?? "" : "");
  const stage = (useSyncExternalStore(subscribeDom, readStage, () => "") || null) as TourStage | null;
  // A customer app's approximate mock-up (the workspace marks it): approving it ships nothing.
  const readMockup = () => (issueId ? document.querySelector(`[data-tour-issue="${CSS.escape(issueId)}"]`)?.getAttribute("data-tour-mockup") ?? "" : "");
  const approximate = useSyncExternalStore(subscribeDom, readMockup, () => "") === "approximate";
  // A pop-up (the full flow, or How should this be built?) owns the screen while it's open.
  const dialogOpen = useSyncExternalStore(subscribeDom, () => !!document.querySelector("[data-slot=flow-dialog], [data-slot=build-choice]"), () => false);

  // Join Slack ticks itself off: ask the server whether Slack knows their email, on a timer and when they come back.
  const [slackJoined, setSlackJoined] = useState<boolean | null>(null);
  const pollSlack = active && hasInvite && state.step <= 2 && slackJoined !== true;
  useEffect(() => {
    if (!pollSlack) return;
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(slackUrl, { cache: "no-store" });
        if (r.ok && !stopped) setSlackJoined(!!((await r.json()) as { joined?: boolean }).joined);
      } catch { /* try again on the next tick */ }
    };
    void check();
    const timer = setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [pollSlack, slackUrl]);

  const card = tourCard({ state, base, path, stage, slackJoined, hasInvite, email, audience, approximate });
  const targetKey = card?.targets.join("\n") ?? "";
  const targets = useMemo(() => (targetKey ? targetKey.split("\n") : []), [targetKey]);

  // Keep the stored step in line with what's showing, so the paused card and a reload say the right step.
  useEffect(() => {
    if (state && card && card.kind !== "away" && card.step !== state.step) writeTour({ ...state, step: card.step });
  }, [state, card]);

  // The outlined element's box, re-read every frame while there's one to outline.
  const readRect = useCallback(() => {
    const el = findTarget(targets);
    const r = el?.getBoundingClientRect();
    // The outline also takes the target's corner radius, so it hugs rounded cards and buttons.
    return el && r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0}` : "";
  }, [targets]);
  const rectRaw = useSyncExternalStore(targets.length ? subscribeFrames : noFrames, readRect, () => "");
  const rect = rectRaw ? rectRaw.split(",").map(Number) : null;

  // Bring each step's target into view once, when it first appears.
  const stepKey = card ? `${card.step}:${card.title}` : "";
  useEffect(() => {
    if (!stepKey || !targets.length) return;
    let tries = 0, id = 0;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const look = () => {
      const el = findTarget(targets);
      if (el) el.scrollIntoView({ block: "center", inline: "center", behavior: smooth ? "smooth" : "auto" });
      else if (++tries < 120) id = requestAnimationFrame(look);
    };
    id = requestAnimationFrame(look);
    return () => cancelAnimationFrame(id);
  }, [stepKey, targets]);

  // Hiding collapses the card to a pill until the next step.
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);

  if (!state || !card || dialogOpen) return null;
  const act = (a: TourAction) => writeTour(nextTourState(state, a, { hasInvite, slackJoined }));

  // Sit bottom-right unless that would cover the outlined element; then bottom-left of the content.
  const covers = rect && typeof window !== "undefined" && rect[0] + rect[2] > window.innerWidth - CARD_W - GAP * 2 && rect[1] + rect[3] > window.innerHeight - CARD_H - BOTTOM - GAP;
  const place = covers ? "left-[4.5rem] md:left-[15.5rem]" : "right-6";
  const position = `fixed bottom-[4.5rem] z-50 max-sm:inset-x-4 ${place}`;
  const stepLabel = `Step ${card.step} of ${TOUR_LENGTH}`;

  if (card.kind === "away" || hiddenAt === stepKey) {
    const back = card.primary && "href" in card.primary ? card.primary.href : null;
    return (
      <aside aria-label="Tour" className={`${position} rise-in flex max-w-[460px] items-center gap-3 rounded-full bg-card px-5 py-2.5 text-sm shadow-pop`}>
        {card.kind === "away" && back ? (
          <><span className="shrink-0 text-muted-foreground">Tour paused.</span><Link href={back} title={state.title} className="link min-w-0 truncate font-medium">Back to {state.title}</Link></>
        ) : (
          <button type="button" onClick={() => setHiddenAt(null)} className="font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60">Show the tour<span className="ml-2 font-normal text-muted-foreground">{stepLabel}</span></button>
        )}
        <button type="button" onClick={() => act("skip")} className={`ml-auto shrink-0 ${quietClass}`}>Skip tour</button>
      </aside>
    );
  }

  return (
    <>
      {rect && (
        <div
          key={stepKey} aria-hidden
          className="pointer-events-none fixed z-40 outline-2 outline-offset-4 outline-[var(--brand)] animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none"
          style={{ left: rect[0], top: rect[1], width: rect[2], height: rect[3], borderRadius: rect[4], outlineStyle: "solid" }}
        />
      )}
      <aside aria-label="Tour" className={`${position} rise-in w-[340px] rounded-2xl bg-card p-5 shadow-pop max-sm:w-auto`}>
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">{stepLabel}{card.kind === "wait" && <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}</span>
          <button type="button" onClick={() => setHiddenAt(stepKey)} aria-label="Hide the tour" title="Hide the tour" className="press grid size-7 place-items-center rounded-full outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><Minus className="size-4" /></button>
        </div>
        <div aria-live="polite">
          <h2 className="mt-1 font-heading text-[26px] font-semibold leading-tight tracking-[-0.01em]">{card.title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-foreground/85">{card.body}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {card.primary && ("href" in card.primary
            ? <Link href={card.primary.href} className={primaryClass}>{card.primary.label}</Link>
            : <button type="button" onClick={() => act((card.primary as { action: TourAction }).action)} className={primaryClass}>{card.primary.label}</button>)}
          {card.back && <button type="button" onClick={() => act("back")} className={quietClass}>Back</button>}
          {card.primary && "action" in card.primary && card.primary.action === "finish"
            ? null
            : <button type="button" onClick={() => act("skip")} className={`ml-auto ${quietClass}`}>Skip tour</button>}
        </div>
      </aside>
    </>
  );
}
