"use client";
import { useEffect } from "react";

/**
 * Moves the light on `.glare` surfaces: one pointer listener for the whole app, at most one write per frame, setting
 * --gx/--gy on the surface under the pointer. Nothing on touch screens or when motion is reduced (the light rests at the top).
 */
export function GlareTracker() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const target = last?.target;
      if (!last || !(target instanceof Element)) return;
      const el = target.closest<HTMLElement>(".glare");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${Math.round(last.clientX - r.left)}px`);
      el.style.setProperty("--gy", `${Math.round(last.clientY - r.top)}px`);
    };
    const onMove = (e: PointerEvent) => { last = e; if (!frame) frame = requestAnimationFrame(apply); };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => { document.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
