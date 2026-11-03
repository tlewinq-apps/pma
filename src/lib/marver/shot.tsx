// PNG screenshots of Marver frames, drawn by PMA (satori, through next/og) from the parsed frame: what the mock
// runner uploads in place of `marver shot`, and the one-image full flow posted to Slack. Import lazily, so next/og
// stays out of routes that never render a frame.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { FRAME_H, FRAME_W, MARK, frameElement } from "@/components/marver/FrameView";
import type { FrameNode, ParsedFrame } from "./frame";

type Font = { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" };
let fonts: Promise<Font[]> | null = null;
/** Inter at the weights the frames use (next/og only bundles a regular weight). Shipped by outputFileTracingIncludes. */
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(([400, 600, 700] as const).map(async (weight) => ({
    name: "Inter", weight, style: "normal" as const,
    data: await readFile(join(process.cwd(), `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`)),
  }))).catch((e) => { console.error("[marver] fonts missing, using the default", e); return []; });
  return fonts;
}

async function png(el: React.ReactElement, width: number, height: number): Promise<Buffer> {
  const res = new ImageResponse(el, { width, height, fonts: await loadFonts() });
  return Buffer.from(await res.arrayBuffer());
}

const SCALE = 2;

/** Whether anything in the frame clips its contents (overflow other than visible). */
const clips = (n: FrameNode): boolean =>
  (n.style.overflow !== undefined && n.style.overflow !== "visible") || n.children.some((c) => typeof c !== "string" && clips(c));

/**
 * One frame at 2x (780×1688 for a Marver frame; `size` for a screen drawn from code), with the proposal's changes
 * ringed when `marks` is set. Satori places an overflow clip as if the frame weren't scaled, so a frame that clips
 * (a popup with overflow hidden, common in screens drawn from code) would lose the rings and borders inside it at 2x:
 * such a frame is drawn at 1x instead. No frame on the demo's canvas clips, so its shots are unchanged.
 */
export async function renderFrameShot(frame: ParsedFrame, o: { marks?: boolean; size?: { w: number; h: number } } = {}): Promise<Buffer> {
  const w = o.size?.w ?? FRAME_W, h = o.size?.h ?? FRAME_H;
  const scale = clips(frame.root) ? 1 : SCALE;
  if (scale === 1) return png(frameElement(frame, { marks: o.marks, size: o.size }), w, h);
  return png(
    <div style={{ display: "flex", width: w * scale, height: h * scale }}>
      <div style={{ display: "flex", width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }}>{frameElement(frame, { marks: o.marks, size: o.size })}</div>
    </div>,
    w * scale, h * scale,
  );
}

export type FlowShotStep = { current: ParsedFrame | null; proposed: ParsedFrame | null; change: "same" | "changed" | "new"; title: string; tap?: string | null };

const THUMB = 210;
const THUMB_H = Math.round((FRAME_H * THUMB) / FRAME_W);
const GAP = 64;
const LABEL_W = 120;
const CHANGE = { same: "Same", changed: "Changed", new: "New" } as const;

/**
 * A frame as a thumbnail. Satori clips a scaled-down subtree to the shrunken box, so each frame is drawn to its own PNG
 * first and placed as an image, which satori scales cleanly.
 */
function thumb(png: string | null, marks: boolean, dim: boolean) {
  if (!png) {
    return <div style={{ display: "flex", width: THUMB, height: THUMB_H, border: "2px dashed #c8cbd0", alignItems: "center", justifyContent: "center", color: "#858b94", fontSize: 15 }}>Not in today&apos;s flow</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- satori markup, not a page
  return <img src={png} width={THUMB} height={THUMB_H} alt="" style={{ border: `1px solid ${marks ? MARK : "#d5d8dc"}`, opacity: dim ? 0.55 : 1 }} />;
}

const dataUri = async (f: ParsedFrame | null, marks: boolean) =>
  f ? `data:image/png;base64,${(await png(frameElement(f, { marks }), FRAME_W, FRAME_H)).toString("base64")}` : null;

/** The whole flow as one image: the current flow on top, the proposed flow below, one column per step. */
export async function renderFlowShot(title: string, steps: FlowShotStep[]): Promise<Buffer> {
  const shots = await Promise.all(steps.map(async (s) => ({ current: await dataUri(s.current, false), proposed: await dataUri(s.proposed, s.change !== "same") })));
  const width = 48 * 2 + LABEL_W + steps.length * THUMB + (steps.length - 1) * GAP;
  const height = 120 + (THUMB_H + 48) * 2 + 40;
  const row = (label: string, side: "current" | "proposed") => (
    <div style={{ display: "flex", alignItems: "flex-start", marginTop: 24 }}>
      <div style={{ display: "flex", width: LABEL_W, fontSize: 18, fontWeight: 600, color: side === "proposed" ? MARK : "#262b33", paddingTop: 8 }}>{label}</div>
      {steps.map((s, k) => (
        <div key={k} style={{ display: "flex", alignItems: "flex-start" }}>
          {k > 0 && (
            <div style={{ display: "flex", flexDirection: "column", width: GAP, height: THUMB_H, alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", width: 30, height: 2, backgroundColor: "#858b94" }} />
                <div style={{ display: "flex", width: 9, height: 9, borderTop: "2px solid #858b94", borderRight: "2px solid #858b94", transform: "rotate(45deg)", marginLeft: -8 }} />
              </div>
              {side === "proposed" && s.tap ? <div style={{ display: "flex", fontSize: 11, color: "#5a626e", marginTop: 6, textAlign: "center" }}>{s.tap}</div> : null}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {side === "current" ? thumb(shots[k].current, false, false) : thumb(shots[k].proposed, s.change !== "same", s.change === "same")}
            <div style={{ display: "flex", marginTop: 8, fontSize: 14, color: "#262b33", fontWeight: side === "proposed" && s.change !== "same" ? 600 : 400 }}>
              {side === "proposed" ? `${CHANGE[s.change]}: ${s.title}` : s.current ? s.title : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
  return png(
    <div style={{ display: "flex", flexDirection: "column", width, height, backgroundColor: "#ece7dc", padding: 48, fontFamily: "Inter" }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#262b33" }}>{title}</div>
      <div style={{ display: "flex", fontSize: 16, color: "#5a626e", marginTop: 6 }}>Current flow on top, proposed flow below. Changes are outlined.</div>
      {row("Current", "current")}
      {row("Proposed", "proposed")}
    </div>,
    width, height,
  );
}
