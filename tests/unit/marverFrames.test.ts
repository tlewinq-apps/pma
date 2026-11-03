// Marver frames drawn by PMA: the parser that reads frame TSX without running it, the renderer, flow boards, the
// design agent's checks and retries, the mock runner's agent path, the flow pop-up's view, and the Slack messages.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_DESIGN } from "@/lib/marver/fixture.generated";
import { parseManifest } from "@/lib/marver/manifest";
import { FrameParseError, frameText, gotoLabel, markCount, parseFrame, tryParseFrame } from "@/lib/marver/frame";
import { frameElement } from "@/components/marver/FrameView";
import { parseFlowBoard, pickFlow, readFlowBoards } from "@/lib/marver/boards";
import { fixtureReader } from "@/lib/marver/reader";
import { validFrameFiles } from "@/lib/drafts/callback";
import { draftEndResult, planFlow, PHONE_FRAME, type Brief, type DraftedFrame } from "@/lib/marver/agent";
import { DEMO_PROFILE } from "@/lib/product/profile";
import { flowState, flowSummary, FLOW_STALE_MS, type DraftFlow } from "@/lib/marver/flowModel";
import { buildFlowView } from "@/lib/queries/flowView";
import { parseInteraction } from "@/lib/slack/interactions";
import { activitySteps, flowMessage, mockupMessage } from "@/lib/slack/messages";
import type { StructuredCaller } from "@/lib/llm/client";

const frameSrc = (id: string) => FIXTURE_DESIGN[`design/scenes/${id}.tsx`];
const FRAMES = parseManifest(JSON.parse(FIXTURE_DESIGN["design/manifest.json"]));
const wrap = (body: string, extra = "") => `const s = { a: { color: "#111" } } as const;\n${extra}\nexport const meta = { title: "T", description: "D" };\nexport default function F() {\n  return (\n    <main style={s.a}>${body}</main>\n  );\n}\n`;

describe("parseFrame", () => {
  it("reads every frame on the canvas, with its meta", () => {
    expect(FRAMES.length).toBe(8);
    for (const f of FRAMES) {
      const p = parseFrame(FIXTURE_DESIGN[f.file]);
      expect(p.root.tag, f.id).toBe("main");
      expect(p.meta.title, f.id).toBe(f.title);
    }
  });
  it("keeps styles from the style table, text the way React reads it, and the flow links", () => {
    const p = parseFrame(frameSrc("friends/list"));
    expect(p.root.style).toMatchObject({ boxSizing: "border-box", width: 390, display: "flex", flexDirection: "column" });
    expect(frameText(p.root)).toContain("Tap a friend to see how your charts get along.");
    expect(gotoLabel(parseFrame(frameSrc("today/index")).root, "friends/list")).toBe("Compare with a friend");
    expect(gotoLabel(p.root, "compatibility/match")).toBe("Leo Martins");
  });
  it("refuses anything that would have to run: imports, hooks, loops, conditions and components", () => {
    const refuse = (src: string, why: RegExp) => expect(() => parseFrame(src)).toThrow(why);
    refuse(`import x from "y";\n${wrap("<p>hi</p>")}`, /import/);
    refuse(wrap("{[1, 2].map((n) => <p>{n}</p>)}"), /function call/);
    refuse(wrap("{true && <p>hi</p>}"), /condition/);
    refuse(wrap("<Chip />"), /component/);
    refuse(wrap("<script>alert(1)</script>"), /isn't supported/);
    refuse(`export default function F() { const [a] = useState(0); return <main>{a}</main>; }`, /function call/);
    refuse(wrap("<p style={s.missing}>x</p>"), /isn't defined/);
    expect(tryParseFrame("not tsx at all <")).toBeNull();
  });
  it("drops event handlers, links and class names, and keeps only data: images", () => {
    const p = parseFrame(wrap(`<button onClick={() => 1} className="x" data-goto="a/b">Go</button><img src="https://evil.example/x.png" /><a href="javascript:alert(1)">l</a>`));
    const [btn, img, a] = p.root.children as { attrs: Record<string, unknown> }[];
    expect(btn.attrs).toEqual({ "data-goto": "a/b" });
    expect(img.attrs.src).toBeUndefined();
    expect(a.attrs).toEqual({});
  });
  it("counts what a proposal marked", () => {
    expect(markCount(parseFrame(wrap(`<div data-pma="new"><p data-pma="changed">x</p></div><p>y</p>`)).root)).toBe(2);
    expect(markCount(parseFrame(frameSrc("today/index")).root)).toBe(0);
  });
});

describe("FrameView", () => {
  it("draws every canvas frame as plain elements", () => {
    for (const f of FRAMES) expect(renderToStaticMarkup(frameElement(parseFrame(FIXTURE_DESIGN[f.file])))).toContain("<div");
  });
  it("never lets a style load anything, and rings only the outermost marked element", () => {
    const html = renderToStaticMarkup(frameElement(parseFrame(wrap(
      `<div data-pma="new" style={{ background: "url(https://evil.example/x)", color: "red" }}><p data-pma="new">in</p></div>`,
    )), { marks: true }));
    expect(html).not.toContain("evil.example");
    expect(html.match(/#2F5FD0/g)?.length).toBe(1);
  });
});

describe("flow boards", () => {
  it("reads steps in their left-to-right order", () => {
    const b = parseFlowBoard("design/boards/flow-x.json", { title: "X", nodes: [{ frame: "b/b", x: 470 }, { frame: "a/a", x: 0 }] });
    expect(b).toMatchObject({ board: "flow-x", title: "X", frames: ["a/a", "b/b"] });
    expect(parseFlowBoard("design/boards/pma-ab12.json", { nodes: [{ frame: "a/a" }] })).toBeNull();
  });
  it("finds the canvas's four flows, and picks Compare with a friend for the Friends screen", async () => {
    const flows = await readFlowBoards(fixtureReader(), "design", new Set(FRAMES.map((f) => f.id)));
    expect(flows.map((f) => f.board).sort()).toEqual(["flow-compare-with-a-friend", "flow-fix-birth-details", "flow-set-up-your-chart", "flow-start-a-trial"]);
    expect(pickFlow(flows, "friends/list", ["friends/list"])?.board).toBe("flow-compare-with-a-friend");
    expect(pickFlow(flows, "today/index", ["plus/upgrade", "today/index"])?.board).toBe("flow-start-a-trial");
    expect(pickFlow(flows, "settings/appearance", [])).toBeNull();
  });
});

describe("callback frame files", () => {
  it("keeps only real frame paths of a sane size", () => {
    const ok = { frame_id: "friends/list", path: "design/scenes/friends/list.tsx", source: "x", changed: "y" };
    expect(validFrameFiles([ok])).toEqual([ok]);
    expect(validFrameFiles([{ ...ok, path: "../../etc/passwd" }])).toEqual([]);
    expect(validFrameFiles([{ ...ok, frame_id: "../x", path: "design/scenes/../x.tsx" }])).toEqual([]);
    expect(validFrameFiles([{ ...ok, source: "x".repeat(20_001) }])).toEqual([]);
    expect(validFrameFiles("nope")).toEqual([]);
  });
});

const brief: Brief = { title: "Comparing takes too many taps", type: "streamline", problem: "Four steps to compare", proposal: { title: "Compare on each row", summary: "A Compare button on every friend" }, quotes: ["way too many taps"] };
const proposed = frameSrc("friends/list").replace("<h1 style={s.h1}>Friends</h1>", `<h1 style={s.h1}>Friends</h1>\n      <div data-pma="new">Compare with anyone in one tap</div>`);
/** A model that answers from a queue. */
const scripted = (...outs: unknown[]) => vi.fn(async () => outs.shift()) as unknown as StructuredCaller & ReturnType<typeof vi.fn>;

describe("design agent", () => {
  const demoApp = { profile: DEMO_PROFILE, size: PHONE_FRAME };
  const frames = [{ frame_id: "friends/list", title: "Friends", source: frameSrc("friends/list") }];
  it("asks again once, with the reason, when a frame can't be drawn", async () => {
    const llm = scripted({ frame_id: "friends/list", tsx: "<main>{x.map(() => 1)}</main>", changed: "c" }, { frame_id: "friends/list", tsx: proposed, changed: "Adds a Compare button" });
    const r = await draftEndResult(llm, brief, frames, demoApp);
    expect(r.frame_id).toBe("friends/list");
    expect(llm).toHaveBeenCalledTimes(2);
    expect((llm.mock.calls[1] as [{ user: string }])[0].user).toContain("couldn't be used");
  });
  it("refuses a frame that marks nothing, or names a screen it wasn't given", async () => {
    await expect(draftEndResult(scripted({ frame_id: "friends/list", tsx: frameSrc("friends/list"), changed: "" }, { frame_id: "today/index", tsx: proposed, changed: "" }), brief, frames, demoApp)).rejects.toBeInstanceOf(FrameParseError);
  });
  it("plans a flow that keeps today's steps in order, allows two new screens, and keeps the end result changed", async () => {
    const end: DraftedFrame = { frame_id: "friends/list", source: proposed, frame: parseFrame(proposed), changed: "c" };
    const flow = { title: "Compare with a friend", frames: ["today/index", "friends/list", "compatibility/match"].map((id) => ({ frame_id: id, title: id, source: frameSrc(id) })) };
    const step = (change: string, frame_id: string) => ({ change, frame_id, title: frame_id, caption: "c", brief: "b" });
    const llm = scripted(
      { steps: [step("same", "friends/list"), step("same", "today/index"), step("same", "compatibility/match")] }, // out of order
      { steps: [step("same", "today/index"), step("same", "friends/list"), step("new", "friends/compare-sheet"), step("changed", "compatibility/match")] },
    );
    const plan = await planFlow(llm, brief, flow, end, DEMO_PROFILE);
    expect(plan.map((s) => [s.frame_id, s.change, s.current])).toEqual([
      ["today/index", "same", "today/index"], ["friends/list", "changed", "friends/list"], ["friends/compare-sheet", "new", null], ["compatibility/match", "changed", "compatibility/match"],
    ]);
    expect(llm).toHaveBeenCalledTimes(2);
  });
});

describe("mock runner with the design agent", () => {
  const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
  const draftId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const payload = {
    draft_id: draftId, branch: "pma/ab12cd-x", mode: "variant", target_frames: ["friends/list"], issue_short_id: "ab12cd",
    title: "Comparing takes too many taps", problem: "p", type: "streamline", solution: "Compare on each row: A Compare button on every friend", quotes: ["q"],
    issue_url: `https://v.app/issues/${issueId}`, callback_url: "https://v.app/api/drafts/callback", callback_token: "t".repeat(48),
    upload_slots: Array.from({ length: 4 }, (_, k) => ({ path: `${issueId}/${draftId}/slot-${k}.png`, url: `https://storage/slot-${k}` })),
  };
  it("sends one current and one proposed shot of the edited frame, with its Marver code", async () => {
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    const post = vi.fn<(url: string, body: unknown) => Promise<void>>(async () => {});
    const { runMockDraft } = await import("@/lib/drafts/mockRunner");
    await runMockDraft(payload, {
      delayMs: 0, post, markFailed: vi.fn(), shoot: async () => Buffer.from("png"),
      loadScreens: async () => [{ frame_id: "friends/list", title: "Friends", description: "Friends list", source: frameSrc("friends/list") }],
      designer: async () => ({ frame_id: "friends/list", source: proposed, frame: parseFrame(proposed), changed: "Adds a Compare button" }),
    });
    vi.unstubAllGlobals();
    const body = post.mock.calls[0][1] as { before: unknown[]; after: unknown[]; frames: { path: string; source: string }[]; marver_paths: string[] };
    expect(put).toHaveBeenCalledTimes(2);
    expect(body.before).toEqual([{ frame_id: "friends/list", path: payload.upload_slots[0].path }]);
    expect(body.after).toEqual([{ frame_id: "friends/list", path: payload.upload_slots[1].path }]);
    expect(body.frames).toEqual([{ frame_id: "friends/list", path: "design/scenes/friends/list.tsx", source: proposed, changed: "Adds a Compare button" }]);
    expect(validFrameFiles(body.frames)).toHaveLength(1);
    expect(body.marver_paths).toEqual(["design/scenes/friends/list.tsx"]);
  });
});

describe("full flow", () => {
  const started = new Date(Date.now() - 1000).toISOString();
  const flow: DraftFlow = {
    status: "ready", board: "flow-compare-with-a-friend", title: "Compare with a friend", started_at: started, current: ["today/index", "friends/list", "compatibility/match"],
    steps: [
      { current: "today/index", frame_id: "today/index", change: "same", title: "Today", caption: "" },
      { current: "friends/list", frame_id: "friends/list", change: "changed", title: "Friends", caption: "Compare on", source: proposed },
      { current: null, frame_id: "friends/compare-sheet", change: "new", title: "Compare sheet", caption: "Pick a friend", source: proposed },
      { current: "compatibility/match", frame_id: "compatibility/match", change: "same", title: "Compatibility", caption: "" },
    ],
  };
  const screens = new Map(["today/index", "friends/list", "compatibility/match"].map((id) => [id, { title: id, source: frameSrc(id) }]));
  it("lines today's steps up over the proposed ones, with a gap over a new screen and the taps between", () => {
    const v = buildFlowView(flow, screens, Date.now(), null);
    expect(v.columns.map((c) => [c.current?.frame_id ?? null, c.proposed?.frame_id, c.proposed?.change])).toEqual([
      ["today/index", "today/index", "same"], ["friends/list", "friends/list", "changed"], [null, "friends/compare-sheet", "new"], ["compatibility/match", "compatibility/match", "same"],
    ]);
    expect(v.columns[1].tapCurrent).toBe("Compare with a friend");
    expect(v.columns[3].tapCurrent).toBe("Leo Martins");
    expect(v.columns.every((c) => c.proposed?.frame)).toBe(true);
    expect(v.summary).toBe("4 steps: 1 changed, 1 new");
  });
  it("shows today's steps while the plan is still being written, and calls a lost run failed", () => {
    const v = buildFlowView({ ...flow, status: "drafting", steps: [] }, screens, Date.now(), null);
    expect(v.columns.map((c) => [c.current?.frame_id, c.proposed])).toEqual([["today/index", null], ["friends/list", null], ["compatibility/match", null]]);
    expect(flowState({ ...flow, status: "drafting" }, Date.parse(started) + FLOW_STALE_MS + 1)).toBe("failed");
    expect(flowSummary([{ change: "same" }])).toBe("1 step");
  });
});

describe("Slack", () => {
  const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
  const draftId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  it("reads the Create full flow button", () => {
    const click = { type: "block_actions", user: { id: "U1" }, response_url: "https://hooks.slack.com/x", actions: [{ action_id: "pma_flow", value: `${issueId}:${draftId}` }] };
    expect(parseInteraction(click)).toMatchObject({ kind: "flow", issueId, draftId });
    expect(parseInteraction({ ...click, actions: [{ action_id: "pma_flow", value: issueId }] })).toEqual({ kind: "ignore" });
  });
  it("offers Create full flow on a mock-up with a Marver frame, and says what changed", () => {
    const base = { issueId, draftId, solutionTitle: "Compare on each row", demo: false, github: false, images: [], prUrl: null, url: "https://v.app/issues/x", closed: null };
    const json = JSON.stringify(mockupMessage({ ...base, flowable: true, changed: "Adds a Compare button", path: "design/scenes/friends/list.tsx" }));
    expect(json).toContain("pma_flow");
    expect(json).toContain("Adds a Compare button");
    expect(JSON.stringify(mockupMessage(base))).not.toContain("pma_flow");
  });
  it("posts the flow with its image and a link that opens the pop-up", () => {
    const m = flowMessage({ title: "Compare with a friend", proposal: "Compare on each row", board: "flow-compare-with-a-friend", summary: "4 steps: 1 changed, 1 new", imageUrl: "https://s.example/f.png", url: "https://v.app/issues/x" });
    const json = JSON.stringify(m);
    expect(json).toContain("https://s.example/f.png");
    expect(json).toContain("https://v.app/issues/x?flow=1");
    expect(activitySteps({ kind: "flow_ready", payload: { draft_id: draftId } }, "PMA")).toEqual([{ kind: "flow", draftId }]);
    expect(activitySteps({ kind: "flow_requested", payload: { flow: "Compare with a friend" } }, "Thomas")[0]).toMatchObject({ kind: "text" });
  });
});
