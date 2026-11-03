"use client";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Show-and-hide, in two parts so the button and the region can sit apart (Activity's button is in the header's meta
 * row, its region spans the header). The region animates its height with grid rows (0fr to 1fr) and fades in, unless motion is reduced.
 */
export function DisclosureButton({ open, onToggle, controls, className, children }: { open: boolean; onToggle: () => void; controls: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
      className={cn("group inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60", className)}
    >
      {children}
      <ChevronDown aria-hidden className="size-3.5 shrink-0 transition-transform duration-200 group-aria-expanded:rotate-180 motion-reduce:transition-none" />
    </button>
  );
}

export function DisclosurePanel({ id, open, className, children }: { id: string; open: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div id={id} inert={!open} className="grid transition-[grid-template-rows] duration-300 ease-smooth motion-reduce:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div className={cn("min-h-0 overflow-hidden transition-[opacity,translate] duration-300 ease-smooth motion-reduce:transition-none", open ? "opacity-100" : "-translate-y-1 opacity-0", className)}>{children}</div>
    </div>
  );
}

/** The usual case: a button with its region right under it. */
export function Disclosure({ label, defaultOpen = false, className, buttonClassName, panelClassName, children }: {
  label: React.ReactNode; defaultOpen?: boolean; className?: string; buttonClassName?: string; panelClassName?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} controls={id} className={buttonClassName}>{label}</DisclosureButton>
      <DisclosurePanel id={id} open={open} className={panelClassName}>{children}</DisclosurePanel>
    </div>
  );
}
