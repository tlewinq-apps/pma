"use client";
import { ViewTransition, addTransitionType, startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { IssueCardData } from "@/lib/queries/issues";
import { attention, groupRails, matchesSearch, parseView, viewGroups, viewLabel, viewMatches, type ViewId } from "./views";
import { ViewBar } from "./ViewBar";
import { Rail } from "./Rail";
import { useApp } from "@/components/app/AppContext";
import type { ProductProfile } from "@/lib/product/profile";

// Pinned views are a per-viewer convenience kept in localStorage, read through an external store so the server
// render (no pins) and the first client render agree. Without storage, pins last for the visit.
const PINNED_KEY = "pma.pinnedViews";
const PINNED_EVENT = "pma:pinned";
let memoryPins = "[]";
function pinnedSnapshot(): string { try { return localStorage.getItem(PINNED_KEY) ?? "[]"; } catch { return memoryPins; } }
function subscribePinned(cb: () => void) {
  window.addEventListener("storage", cb); window.addEventListener(PINNED_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(PINNED_EVENT, cb); };
}
function parsePinned(raw: string): ViewId[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? [...new Set(v.map((x) => parseView(String(x))).filter((x) => x !== "all"))] : []; } catch { return []; }
}
function writePinned(v: ViewId[]) {
  memoryPins = JSON.stringify(v);
  try { localStorage.setItem(PINNED_KEY, memoryPins); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(PINNED_EVENT));
}

/** The desk: views across the top, the Urgent rail on top, then one sliding rail per type (bugs first), keyboard-first navigation. */
export function Hub({ issues, filteredCount, meEmail, initialView, focusId, feedbackFrom = "Member feedback", profile = null }: {
  issues: IssueCardData[]; filteredCount: number; meEmail: string | null; initialView: ViewId; focusId: string | null;
  /** Whose feedback the Desk sorts, in the app's words: "Member feedback" (the demo), "Feedback from shoppers", or "Feedback". */
  feedbackFrom?: string;
  /** A customer app's product profile, so each card counts people in its audience words. The demo passes none. */
  profile?: ProductProfile | null;
}) {
  const { href } = useApp();
  const [view, setView] = useState<ViewId>(initialView);
  const pinnedRaw = useSyncExternalStore(subscribePinned, pinnedSnapshot, () => "[]");
  const pinned = useMemo(() => parsePinned(pinnedRaw), [pinnedRaw]);
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const railsBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Coming back from a workspace: bring the card you left into view and focus it.
  useEffect(() => {
    if (!focusId) return;
    const el = railsBox.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focusId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus({ preventScroll: true });
  }, [focusId]);

  // Switching views is a transition: the tab's pill glides over and the rails crossfade.
  const select = (v: ViewId) => {
    startTransition(() => { addTransitionType("view-switch"); setView(v); });
    window.history.replaceState(null, "", href(v === "all" ? "/" : `/?view=${encodeURIComponent(v)}`));
  };
  const pin = (v: ViewId) => { if (!pinned.includes(v)) writePinned([...pinned, v]); };
  const unpin = (v: ViewId) => {
    writePinned(pinned.filter((x) => x !== v));
    if (view === v) select("all");
  };

  const count = (v: ViewId) => issues.filter((i) => viewMatches(v, i, meEmail)).length;
  const shown = issues.filter((i) => viewMatches(view, i, meEmail) && matchesSearch(i, q));
  const rails = groupRails(shown).filter((r) => view === "all" && !q ? true : r.items.length > 0);
  const groups = useMemo(() => viewGroups(issues), [issues]);
  const tabs = view === "all" || pinned.includes(view) ? pinned : [...pinned, view];
  const alert = attention(issues);
  const hrefFor = (id: string) => href(`/issues/${id}${view === "all" ? "" : `?from=${encodeURIComponent(view)}`}`);

  // Arrow keys move between cards: left/right along a rail, up/down to the nearest card on the next non-empty rail.
  const onRailsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
    if (!card || !railsBox.current) return;
    const r = Number(card.dataset.rail), p = Number(card.dataset.pos);
    const at = (rail: number, pos: number) => railsBox.current!.querySelector<HTMLElement>(`[data-rail="${rail}"][data-pos="${pos}"]`);
    let next: HTMLElement | null = null;
    if (e.key === "ArrowRight") next = at(r, p + 1);
    else if (e.key === "ArrowLeft") next = at(r, p - 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const dir = e.key === "ArrowDown" ? 1 : -1;
      for (let k = r + dir; k >= 0 && k < rails.length && !next; k += dir) if (rails[k].items.length) next = at(k, Math.min(p, rails[k].items.length - 1));
    }
    if (!next) return;
    e.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-7 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold">Desk</h1>
            <span className="text-sm text-muted-foreground">{count("all")} open</span>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">{feedbackFrom} sorted into bugs, new features, add-ons and things to streamline, most urgent first. Every issue starts with one first step. New here? <Link href={href("/welcome")} className="link">Start here</Link>.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {alert.review > 0 && <button type="button" onClick={() => select("review")} className="flex items-center gap-2 text-[var(--stage-review)] link"><span aria-hidden className="size-1.5 rounded-full bg-[var(--stage-review)]" />{alert.review} ready for review</button>}
          {alert.failed > 0 && <button type="button" onClick={() => select("ready_to_implement")} className="flex items-center gap-2 text-[var(--stage-failed)] link"><span aria-hidden className="size-1.5 rounded-full bg-[var(--stage-failed)]" />{alert.failed} draft{alert.failed > 1 ? "s" : ""} failed</button>}
          {filteredCount > 0 && <Link href={href("/feedback?status=done")} title="Pieces of feedback that weren't about the product, such as small talk and staff replies. Open a source to see them greyed out." className="text-muted-foreground hover:text-foreground">{filteredCount} set aside</Link>}
          <label className="field flex h-9 w-64 items-center gap-2 px-3 text-muted-foreground">
            <Search aria-hidden className="size-3.5 shrink-0" />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } }} placeholder="Search titles, screens, proposals" aria-label="Search" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] shadow-[inset_0_-1px_0_rgb(46_43_43/0.12)]">/</kbd>
          </label>
        </div>
      </header>

      <ViewBar view={view} tabs={tabs} pinned={pinned} groups={groups} count={count} onSelect={select} onPin={pin} onUnpin={unpin} />

      <ViewTransition key={view} enter={{ "view-switch": "swap", default: "none" }} exit={{ "view-switch": "swap", default: "none" }} default="none">
      <div ref={railsBox} onKeyDown={onRailsKey} className="space-y-9">
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-foreground/20 py-16 text-center">
            <p className="text-sm">{q ? `Nothing matches “${q}”` : `Nothing in ${viewLabel(view)} right now`}</p>
            <button type="button" onClick={() => { setQ(""); select("all"); }} className="mt-3 link text-sm text-muted-foreground hover:text-foreground">Show everything open</button>
          </div>
        ) : rails.map((r, k) => <Rail key={r.type} rail={r} index={k} hrefFor={hrefFor} profile={profile} />)}
      </div>
      </ViewTransition>
    </div>
  );
}
