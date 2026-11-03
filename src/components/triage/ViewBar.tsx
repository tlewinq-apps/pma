"use client";
import { ViewTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { viewHint, viewLabel, type ViewId } from "./views";

/** "All" plus the views the user pinned from the + menu. Each tab shows its count; pinned tabs can be unpinned. */
export function ViewBar({ view, tabs, pinned, groups, count, onSelect, onPin, onUnpin }: {
  view: ViewId; tabs: ViewId[]; pinned: ViewId[]; groups: { label: string; views: ViewId[] }[]; count: (v: ViewId) => number;
  onSelect: (v: ViewId) => void; onPin: (v: ViewId) => void; onUnpin: (v: ViewId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
    <div role="tablist" aria-label="Views" className="flex flex-wrap items-center gap-0.5 rounded-xl bg-foreground/[0.05] p-1 shadow-[inset_0_1px_2px_rgb(46_43_43/0.06)]">
      {(["all", ...tabs] as ViewId[]).map((v) => {
        const active = v === view;
        return (
          <span key={v} className={`group/tab relative isolate flex h-8 items-center rounded-lg text-sm transition-colors duration-200 ${active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {active && (
              <ViewTransition name="view-tab" share="glide" default="none">
                <span aria-hidden className="absolute inset-0 -z-10 rounded-lg bg-card shadow-[0_0_0_1px_rgb(46_43_43/0.06),0_1px_2px_rgb(46_43_43/0.08),0_3px_8px_-4px_rgb(46_43_43/0.16)]" />
              </ViewTransition>
            )}
            <button type="button" role="tab" aria-selected={active} onClick={() => onSelect(v)} className="press flex h-full items-center gap-2 rounded-lg pl-3 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              {viewLabel(v)}<span className="tabular-nums text-muted-foreground">{count(v)}</span>
            </button>
            {v !== "all" && pinned.includes(v) && (
              <button type="button" aria-label={`Unpin ${viewLabel(v)}`} onClick={() => onUnpin(v)} className="-ml-1.5 mr-1 grid size-5 place-items-center rounded-full opacity-0 transition-opacity duration-200 hover:bg-foreground/10 group-hover/tab:opacity-100 focus-visible:opacity-100">
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
    </div>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Add a view" className="press grid size-9 place-items-center rounded-xl border border-dashed border-foreground/20 text-muted-foreground outline-none hover:border-foreground/40 hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
          <Plus className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          {groups.filter((g) => g.views.length).map((g, k) => (
            <DropdownMenuGroup key={g.label}>
              {k > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
              {g.views.map((v) => (
                <DropdownMenuItem key={v} onClick={() => { if (!pinned.includes(v)) onPin(v); onSelect(v); }} className="items-start py-1.5">
                  <span className="flex-1">
                    <span className="block">{viewLabel(v)}</span>
                    {viewHint(v) && <span className="block text-xs text-muted-foreground">{viewHint(v)}</span>}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground">{count(v)}</span>
                  {pinned.includes(v) && <Check className="size-3.5 text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
