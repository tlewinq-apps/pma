"use client";
import { useEffect } from "react";

/**
 * Remembers the app the user has open, so "open PMA" (lastAppHref) can bring them back to it. A server layout can't
 * set cookies, so the browser writes it. `value` is "<org>/<app>"; both are slugs, which need no encoding.
 */
export function RememberApp({ name, value }: { name: string; value: string }) {
  useEffect(() => {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  }, [name, value]);
  return null;
}
