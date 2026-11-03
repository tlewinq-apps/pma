import { ViewTransition } from "react";

// Navigations say which way they go (Link/router transitionTypes); everything else, router.refresh() polling included,
// swaps in place with no animation.
const MOVES = { "nav-section": "page-rise", "nav-forward": "page-forward", "nav-back": "page-back", default: "none" };

/** Wraps a page's content so it rises in from the sidebar, or slides deeper and back. Goes in each page, not the layout. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <ViewTransition enter={MOVES} exit={MOVES} default="none">{children}</ViewTransition>;
}
