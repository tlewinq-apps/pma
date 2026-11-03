"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Long enough for a big batch of files; after that a reload shows where things got to. */
const GIVE_UP_MS = 15 * 60_000;

/** Analysis finishes on the server; while anything under Received is still working, refresh the list until it lands. */
export function RefreshWhileWorking({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => router.refresh(), 4000);
    const stop = setTimeout(() => clearInterval(tick), GIVE_UP_MS);
    return () => { clearInterval(tick); clearTimeout(stop); };
  }, [active, router]);
  return null;
}
