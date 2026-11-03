// Mockup images for Slack, which only shows public PNG/JPG/GIF. Real drafts already have public PNGs in the `shots`
// bucket. Demo drafts are SVG data URIs, and rasterizing those with resvg drops their <text> (no fonts on the server),
// so the demo frame is drawn again as JSX: satori turns the text into paths with Next's bundled font.
import { ImageResponse } from "next/og";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demoFrameModel, type DemoFrameModel } from "@/lib/drafts/demo";
import { isHttps } from "./kit";

function Frame({ m, heading }: { m: DemoFrameModel; heading: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", fontSize: 14, color: "#5f5e5a", marginBottom: 8 }}>{heading}</div>
      <div style={{ display: "flex", flexDirection: "column", position: "relative", width: m.W, height: m.H, background: "#f7f6f3", border: "2px solid #d3d1c7", borderRadius: 30, padding: "16px 24px" }}>
        <div style={{ display: "flex", fontSize: 11, color: "#888780" }}>9:41</div>
        <div style={{ display: "flex", fontSize: 20, color: "#2c2c2a", marginTop: 24 }}>{m.title}</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
          {m.rows.map((r, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", height: 38, marginBottom: 12, paddingLeft: 14, borderRadius: 10, background: "#ffffff", border: "1px solid #e4e2dc", fontSize: 13, color: "#4a4842" }}>{r}</div>
          ))}
        </div>
        {m.callout && (
          <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 18, right: 18, bottom: 52, padding: "12px 14px", borderRadius: 12, background: "#e7f6ef", border: "2px solid #1d9e75" }}>
            <div style={{ display: "flex", fontSize: 11, color: "#0f6e56", marginBottom: 6 }}>Proposed change</div>
            {m.callout.head.map((l, k) => <div key={`h${k}`} style={{ display: "flex", fontSize: 14, color: "#085041" }}>{l}</div>)}
            <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
              {m.callout.body.map((l, k) => <div key={`b${k}`} style={{ display: "flex", fontSize: 11.5, color: "#0f6e56" }}>{l}</div>)}
            </div>
          </div>
        )}
        <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: 14, justifyContent: "center", fontSize: 10, color: "#b4b2a9" }}>{m.label}</div>
      </div>
    </div>
  );
}

const PAIR = { width: 700, height: 640 };

/** One frame as PNG bytes: what the mock runner uploads in place of a `marver shot` screenshot. */
export async function renderFramePng(m: DemoFrameModel, heading: string): Promise<Buffer> {
  const res = new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#ffffff", justifyContent: "center", alignItems: "center" }}>
      <Frame m={m} heading={heading} />
    </div>,
    { width: m.W + 60, height: m.H + 70 },
  );
  return Buffer.from(await res.arrayBuffer());
}

/** Current and proposed side by side, as PNG bytes. */
export async function renderDemoPair(before: DemoFrameModel, after: DemoFrameModel): Promise<Buffer> {
  const res = new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#ffffff", justifyContent: "center", alignItems: "center", gap: 40 }}>
      <Frame m={before} heading="Current" />
      <Frame m={after} heading="Proposed" />
    </div>,
    PAIR,
  );
  return Buffer.from(await res.arrayBuffer());
}

type Img = { frame_id: string; url: string };
export type DraftForImages = {
  id: string; issue_id: string; demo: boolean; solution_id: string | null;
  before_images: Img[] | null; after_images: Img[] | null;
};

/**
 * Labelled https images for a ready draft (at most 2 screens). `reuse` points at demo PNGs uploaded earlier instead of
 * rendering again (closing a posted mockup). Never throws: no images just means a text-only message.
 */
export async function mockupImages(db: SupabaseClient, projectId: string, d: DraftForImages, opts: { reuse?: boolean } = {}): Promise<{ label: string; url: string }[]> {
  try {
    const before = (d.before_images ?? []).slice(0, 2), after = (d.after_images ?? []).slice(0, 2);
    const frames = [...new Set([...before, ...after].map((i) => i.frame_id))];
    const { data: screens } = await db.from("screens").select("frame_id, title, description").eq("project_id", projectId).in("frame_id", frames.length ? frames : ["-"]);
    const screen = new Map((screens ?? []).map((s) => [s.frame_id as string, s as { frame_id: string; title: string | null; description: string | null }]));
    const name = (f: string) => screen.get(f)?.title || f;
    if (!d.demo) {
      return frames.flatMap((f) => [
        ...before.filter((i) => i.frame_id === f && isHttps(i.url)).map((i) => ({ label: `Current: ${name(f)}`, url: i.url })),
        ...after.filter((i) => i.frame_id === f && isHttps(i.url)).map((i) => ({ label: `Proposed: ${name(f)}`, url: i.url })),
      ]);
    }
    const { data: s } = d.solution_id && !opts.reuse ? await db.from("solutions").select("title, summary").eq("id", d.solution_id).maybeSingle() : { data: null };
    const proposal = s ? { title: s.title as string, summary: s.summary as string } : undefined;
    const out: { label: string; url: string }[] = [];
    for (const [k, f] of frames.entries()) {
      const path = `slack/${d.issue_id}/${d.id}/${k}.png`;
      if (!opts.reuse) {
        const base = { title: name(f), description: screen.get(f)?.description ?? "" };
        const png = await renderDemoPair(demoFrameModel({ ...base, side: "before" }), demoFrameModel({ ...base, side: "after", proposal }));
        const { error } = await db.storage.from("shots").upload(path, png, { contentType: "image/png", upsert: true });
        if (error) throw new Error(error.message);
      }
      out.push({ label: `Current and proposed: ${name(f)}`, url: db.storage.from("shots").getPublicUrl(path).data.publicUrl });
    }
    return out;
  } catch (e) {
    console.error("[slack] mockup images failed", e);
    return [];
  }
}
