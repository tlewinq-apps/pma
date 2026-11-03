"use client";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import type { IssueType } from "@/lib/types";
import { startTour } from "@/lib/tour/steps";
import { readTour, writeTour } from "./tourStore";

/** Start here's tour button. A first sign-in lands on /welcome?tour=1, which starts it once; the button restarts it. */
export function TourStart({ id, title, type, auto }: { id: string; title: string; type: IssueType; auto: boolean }) {
  useEffect(() => {
    if (auto && !readTour()) writeTour(startTour({ id, title, type }));
  }, [auto, id, title, type]);
  return (
    <button
      type="button" onClick={() => writeTour(startTour({ id, title, type }))}
      className="inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      Start the tour<ArrowRight aria-hidden className="size-4" />
    </button>
  );
}
