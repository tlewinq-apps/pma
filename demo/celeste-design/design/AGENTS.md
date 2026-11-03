# Celeste design canvas

This folder is a Marver canvas for Celeste, a sample astrology app. Each screen is one frame at
`design/scenes/<scene>/<frame>.tsx`, described in `design/manifest.json`.

Rules for agents editing it:
- Only change files under `design/scenes/` and `design/boards/`. Never touch app code.
- Keep each frame self-contained: one default-exported component, inline styles, no imports.
- Keep `meta.title` and `meta.description` accurate; PMA reads them to map feedback to screens.
- Follow `design/instructions/iterate.md` for variants and rounds.

Flows:
- A flow is a board at `design/boards/flow-<name>.json`. Its `nodes` are the steps in order, left to right
  (`x` grows by 470, `y` stays 0).
- Link each step to the next with `data-goto="<scene>/<frame>"` on the element the member taps.

Frames PMA drafts and renders:
- PMA renders frames without running them, so write each frame as plain markup: one `const s = {...}` style
  table, `export const meta`, and a default-exported function that returns JSX. No imports, hooks, `.map()`,
  conditionals or helper components; write every element out.
- Draw switches, chips and other controls with styled `div`, `span` and `button` elements, not native inputs.
- The screen style keeps `boxSizing: "border-box"` so the frame fits its 390px width.
- Mark each element you add with `data-pma="new"` and each one you change with `data-pma="changed"`.
  PMA outlines them for review; Marver ignores them.
