// Demo drafter, pure core. When no design repo + GitHub token is configured, Implement still runs end to end:
// the draft is recorded as `demo`, advances to ready after DEMO_DRAFT_MS (checked lazily on read, no timers), and
// gets schematic before/after frames rendered here. The database side lives in demoRepo.ts.
import { branchName } from "./callback";

export const DEMO_DRAFT_MS = 6_000;

export type DraftBackend = "github" | "mock" | "demo";

/**
 * Whether the deployment's GITHUB_TOKEN may act for an app: only for the demo app. Any company owner or admin can
 * point their own app at any public repository (POST /api/apps/[appId]/repo), so a customer app never dispatches,
 * merges, closes or reads anything with that token. Its repository is read through openRepo (no token) until the
 * PMA GitHub App gives it a token of its own.
 */
export function mayUseDeploymentToken(kind: string | null | undefined): boolean {
  return kind === "demo";
}

/**
 * Who drafts a mockup. `mock` (DRAFT_BACKEND=mock) plays the GitHub Action in-app through the real dispatch and
 * callback contract (drafts/mockRunner.ts); `github` runs Marver in Actions, for the demo app only (it needs the
 * deployment's token, see mayUseDeploymentToken); `demo` renders schematic frames directly.
 */
export function draftBackend(
  app: { kind: string | null | undefined; repo_full_name: string | null | undefined },
  token: string | null | undefined,
  mode: string | null | undefined = process.env.DRAFT_BACKEND,
): DraftBackend {
  if (mode === "mock") return "mock";
  return mayUseDeploymentToken(app.kind) && app.repo_full_name && token ? "github" : "demo";
}

export function demoAdvanceDue(d: { status: string; demo: boolean; created_at: string } | null | undefined, now: number): boolean {
  if (!d || !d.demo || d.status !== "dispatched") return false;
  const t = Date.parse(d.created_at);
  return Number.isFinite(t) && now - t >= DEMO_DRAFT_MS;
}

export const demoBranch = (shortId: string, title: string, draftId: string) => branchName(shortId, title, draftId).replace(/^pma\//, "demo/");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Greedy word wrap by character count; the last kept line gets an ellipsis when text is cut. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + word).length > width) { lines.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, "")}…`; return kept; }
  return lines;
}

/** "Form: date of birth, birth time, Continue" → ["Date of birth", "Birth time", "Continue"]. */
function rowsOf(description: string): string[] {
  const body = description.includes(":") ? description.slice(description.indexOf(":") + 1) : description;
  return body.split(/[,;]|\band\b/).map((s) => s.trim()).filter(Boolean).slice(0, 5).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

export type DemoFrameInput = { title: string; description: string; side: "before" | "after"; proposal?: { title: string; summary: string }; source?: string };

export type DemoFrameModel = { W: number; H: number; title: string; rows: string[]; callout: { head: string[]; body: string[] } | null; label: string };

/** The schematic's content and layout inputs, shared by the SVG below and the PNG render for Slack. */
export function demoFrameModel({ title, description, side, proposal, source = "Demo render" }: DemoFrameInput): DemoFrameModel {
  return {
    W: 300, H: 560, title, rows: rowsOf(description),
    callout: side === "after" && proposal ? { head: wrap(proposal.title, 30, 2), body: wrap(proposal.summary, 38, 5) } : null,
    label: `${source} · ${side === "after" ? "proposed" : "current"}`,
  };
}

/** A phone-shaped schematic of one screen, as an SVG data URI. Every string is escaped before it reaches markup. */
export function renderDemoFrame(input: DemoFrameInput): string {
  const { W, H, title, rows: rowText, callout: c, label } = demoFrameModel(input);
  const rows = rowText.map((r, k) => {
    const y = 104 + k * 50;
    return `<rect x="24" y="${y}" width="${W - 48}" height="38" rx="10" fill="#ffffff" stroke="#e4e2dc"/><text x="38" y="${y + 24}" font-size="13" fill="#4a4842">${esc(r)}</text>`;
  }).join("");
  let callout = "";
  if (c) {
    const { head, body } = c;
    const h = 44 + head.length * 18 + body.length * 16;
    const y = H - 52 - h;
    callout = `<rect x="18" y="${y}" width="${W - 36}" height="${h}" rx="12" fill="#e7f6ef" stroke="#1d9e75" stroke-width="2"/>`
      + `<text x="32" y="${y + 22}" font-size="11" fill="#0f6e56">Proposed change</text>`
      + head.map((l, k) => `<text x="32" y="${y + 42 + k * 18}" font-size="14" font-weight="600" fill="#085041">${esc(l)}</text>`).join("")
      + body.map((l, k) => `<text x="32" y="${y + 46 + head.length * 18 + k * 16}" font-size="11.5" fill="#0f6e56">${esc(l)}</text>`).join("");
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Geist, -apple-system, Helvetica, Arial, sans-serif">`
    + `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="30" fill="#f7f6f3" stroke="#d3d1c7" stroke-width="2"/>`
    + `<text x="26" y="34" font-size="11" fill="#888780">9:41</text>`
    + `<text x="24" y="76" font-size="20" font-weight="600" fill="#2c2c2a">${esc(title)}</text>`
    + rows + callout
    + `<text x="${W / 2}" y="${H - 20}" font-size="10" text-anchor="middle" fill="#b4b2a9">${label}</text>`
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
