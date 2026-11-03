// The welcome tour's progress is a per-viewer convenience kept in localStorage, read through an external store (like
// the Desk's pinned views) so the server render (no tour) and the first client render agree. Without storage, the
// tour lasts for the visit.
import type { TourState } from "@/lib/tour/steps";

const KEY = "pma.tour";
const EVENT = "pma:tour";
let memory = "";

export function tourSnapshot(): string { try { return localStorage.getItem(KEY) ?? ""; } catch { return memory; } }
export function subscribeTour(cb: () => void) {
  window.addEventListener("storage", cb); window.addEventListener(EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVENT, cb); };
}
export function parseTour(raw: string): TourState | null {
  try {
    const v = JSON.parse(raw) as Partial<TourState> | null;
    return v && v.v === 1 && typeof v.issueId === "string" && typeof v.step === "number" ? (v as TourState) : null;
  } catch { return null; }
}
export const readTour = () => parseTour(tourSnapshot());
export function writeTour(s: TourState) {
  memory = JSON.stringify(s);
  try { localStorage.setItem(KEY, memory); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT));
}
