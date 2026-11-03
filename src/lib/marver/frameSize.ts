// How big a frame is drawn. A Marver canvas is always a phone (390 by 844); a screen PMA draws from an app's own code
// takes the app's platform: a desktop window for the web, a phone for mobile, and for an app that ships both, the
// platform the feedback came from (a desktop window unless it plainly came from a phone). Pure: shared by the design
// agent (server), the dispatcher and the issue page.
import type { ProductProfile } from "@/lib/product/profile";

export type FrameSize = { w: number; h: number };
export const PHONE_FRAME: FrameSize = Object.freeze({ w: 390, h: 844 });
export const WEB_FRAME: FrameSize = Object.freeze({ w: 1280, h: 800 });

const WEB_WORDS = /\b(web|website|browser|desktop|laptop|computer|chrome|safari|firefox|edge)\b/i;
const PHONE_WORDS = /\b(phone|iphone|android|ios|mobile|tablet|ipad)\b/i;

/** The size to draw `p`'s screens at; `where` is where the feedback came from (source channels, the finding's screen). */
export function frameSizeFor(p: ProductProfile, where: readonly string[] = []): FrameSize {
  if (p.platform === "web") return WEB_FRAME;
  if (p.platform === "mobile") return PHONE_FRAME;
  const said = where.join(" ");
  return PHONE_WORDS.test(said) && !WEB_WORDS.test(said) ? PHONE_FRAME : WEB_FRAME;
}
