// npm run seed:snapshot — loads a pre-computed demo of the Celeste sources (no Anthropic / Voyage calls) into the
// demo company's Celeste app (made when missing). Replaces the app's sources, issues and screens each run, so it
// is safe to re-run. Use `npm run seed` instead once API keys are set to run the real pipeline.
import { readFileSync } from "node:fs";
import { serviceDb } from "../src/lib/db/server";
import { contentHash } from "../src/lib/text";
import { JOBS, SCREENS } from "./demo/celeste";
import { buildSnapshot, datedFromToday, demoAlertRules, EXTRA_SOURCES, type DemoSource } from "./demo/snapshot";
import { FIXTURE_DESIGN } from "../src/lib/marver/fixture.generated";
import { extractCopy, parseManifest } from "../src/lib/marver/manifest";
import { readFlowBoards } from "../src/lib/marver/boards";
import { fixtureReader } from "../src/lib/marver/reader";
import { saveFlows } from "../src/lib/marver/sync";
import { ensureDemoApp, ensureDemoOrg } from "./lib/demo-app";
import { assertNotProd } from "./lib/guard";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

async function main() {
  assertNotProd("seed-snapshot");
  const db = serviceDb();
  const projectId = await ensureDemoApp(db, await ensureDemoOrg(db));

  // Alerts reach every member until someone picks recipients in Settings > Alerts (choices already made are kept),
  // and the jump alert is set so the community-call sample triggers it.
  const { data: proj } = await db.from("projects").select("alert_rules").eq("id", projectId).single();
  const { data: members } = await db.rpc("service_member_emails", { p_project: projectId });
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  must(await db.from("projects").update({ alert_rules: demoAlertRules(proj?.alert_rules, memberIds) }).eq("id", projectId).select("id"), "alert rules");

  // Fresh snapshot: cascades remove units, issue/unit screens, solutions, drafts and activity.
  must(await db.from("issues").delete().eq("project_id", projectId).select("id"), "clear issues");
  must(await db.from("sources").delete().eq("project_id", projectId).select("id"), "clear sources");
  must(await db.from("screens").delete().eq("project_id", projectId).select("id"), "clear screens");
  must(await db.from("jobs").upsert(JOBS.map((j) => ({ current_flow_md: null, ...j, project_id: projectId })), { onConflict: "project_id,code" }).select("id"), "jobs");

  const jobs = must(await db.from("jobs").select("id,code").eq("project_id", projectId), "read jobs") as { id: string; code: string }[];
  const jobId = new Map(jobs.map((j) => [j.code, j.id]));
  // Screens carry the built-in design canvas's copy, exactly what Settings > Sync screens now reads (marverContract
  // pins its frame ids to SCREENS).
  const frames = new Map(parseManifest(JSON.parse(FIXTURE_DESIGN["design/manifest.json"])).map((f) => [f.id, f]));
  const screens = must(await db.from("screens").insert(SCREENS.map((s) => {
    const f = frames.get(s.frame_id);
    return { ...s, project_id: projectId, file: f?.file ?? `design/scenes/${s.frame_id}.tsx`, copy_text: f ? extractCopy(FIXTURE_DESIGN[f.file] ?? "") : s.description, source: f ? FIXTURE_DESIGN[f.file] ?? null : null };
  })).select("id,frame_id"), "screens") as { id: string; frame_id: string }[];
  // The canvas's flow boards (design/boards/flow-*.json), the same ones Sync screens now reads.
  await saveFlows(db, projectId, await readFlowBoards(fixtureReader(), "design", new Set(screens.map((s) => s.frame_id))));
  const screenId = new Map(screens.map((s) => [s.frame_id, s.id]));

  // Dated relative to today (datedFromToday), so a fresh seed keeps the birth time bug in the Urgent rail.
  const demoSources = datedFromToday([...(JSON.parse(readFileSync("eval/fixtures/sources.json", "utf8")) as DemoSource[]), ...EXTRA_SOURCES]);
  const sourceRows = must(await db.from("sources").insert(demoSources.map((s) => ({
    project_id: projectId, kind: s.kind, channel: s.channel, author: s.author, occurred_at: s.occurred_at, raw_text: s.raw_text,
    content_hash: contentHash(s.raw_text), route: s.route ?? null, demo: true, status: "done", attempts: 1,
  }))).select("id,content_hash"), "sources") as { id: string; content_hash: string }[];
  const sourceId = new Map(demoSources.map((s) => [s.id, sourceRows.find((r) => r.content_hash === contentHash(s.raw_text))!.id]));
  // Each piece is dated when its source happened, as the pipeline dates it (urgency and recency read this).
  const occurredAt = new Map(demoSources.map((s) => [s.id, s.occurred_at]));

  const snap = buildSnapshot(demoSources);
  const unitRow = (u: (typeof snap.praise)[number] | (typeof snap.issues)[number]["units"][number], issueId: string | null, job: string | null) => ({
    source_id: sourceId.get(u.source), occurred_at: occurredAt.get(u.source), project_id: projectId, issue_id: issueId, quote: u.quote, span_start: u.span_start, span_end: u.span_end,
    speakers: u.speakers, corroborators: u.corroborators ?? [], reported_count: u.reported_count ?? 0, type: u.type,
    sentiment: u.sentiment, emotion: u.emotion, audience: "users", severity_signals: u.signals ?? {}, job_code: job,
  });

  for (const i of snap.issues) {
    const issue = must(await db.from("issues").insert({
      project_id: projectId, title: i.title, problem_statement: i.problem, type: i.type, job_id: i.job ? jobId.get(i.job) ?? null : null,
      lane: i.lane, importance: i.importance, ease: i.ease, score_breakdown: i.breakdown, people_count: i.people_count, diagnosis: i.diagnosis,
    }).select("id").single(), `issue ${i.key}`) as { id: string };
    const units = must(await db.from("feedback_units").insert(i.units.map((u) => unitRow(u, issue.id, i.job))).select("id"), `units ${i.key}`) as { id: string }[];
    const scr = i.screens.map((s, position) => ({ screen_id: screenId.get(s.frame_id)!, position, confidence: s.confidence, evidence: s.evidence }));
    if (scr.length) {
      must(await db.from("issue_screens").insert(scr.map((s) => ({ issue_id: issue.id, ...s }))).select("issue_id"), `issue screens ${i.key}`);
      must(await db.from("unit_screens").insert(units.flatMap((u) => scr.map(({ screen_id, confidence, evidence }) => ({ unit_id: u.id, screen_id, confidence, evidence })))).select("unit_id"), `unit screens ${i.key}`);
    }
    if (i.solutions.length) {
      must(await db.from("solutions").insert(i.solutions.map((s, k) => ({ issue_id: issue.id, rank: k + 1, title: s.title, summary: s.summary, tradeoffs: s.tradeoffs, effort: s.effort, risk: s.risk, recommended: !!s.recommended, mode: s.mode, target_frames: s.target_frames }))).select("id"), `solutions ${i.key}`);
    }
    // Scored two days ago, so a burst of new feedback during the demo reads as a jump against this baseline.
    const scoredAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    must(await db.from("activity").insert([
      { issue_id: issue.id, kind: "priority_changed", payload: { from: null, to: i.importance, reason: "First scored" }, at: scoredAt },
      { issue_id: issue.id, kind: "lane_changed", payload: { from: null, to: i.lane }, at: scoredAt },
    ]).select("id"), `activity ${i.key}`);
  }

  for (const p of snap.praise) {
    const [u] = must(await db.from("feedback_units").insert(unitRow(p, null, null)).select("id"), "praise") as { id: string }[];
    must(await db.from("unit_screens").insert(p.screens.map((s) => ({ unit_id: u.id, screen_id: screenId.get(s.frame_id)!, confidence: s.confidence, evidence: s.evidence }))).select("unit_id"), "praise screens");
  }

  // One illustrative filtered unit, so the Filtered tab and greyed spans have something to show.
  const call = demoSources.find((s) => s.id === "call")!;
  const staff = "Staff: I am sorry to hear that. Can you walk me through what you tapped?";
  const at = call.raw_text.indexOf(staff);
  if (at >= 0) must(await db.from("feedback_units").insert({ source_id: sourceId.get("call"), occurred_at: call.occurred_at, project_id: projectId, quote: staff, span_start: at, span_end: at + staff.length, type: "irrelevant", filtered_reason: "Staff reply, not customer feedback" }).select("id"), "filtered");

  const lanes = snap.issues.reduce<Record<string, number>>((a, i) => ({ ...a, [i.lane]: (a[i.lane] ?? 0) + 1 }), {});
  console.log(`Celeste ${projectId}: ${demoSources.length} sources, ${snap.issues.length} issues`, lanes, `${snap.praise.length} praise, ${SCREENS.length} screens`);
}
main().catch((e) => { console.error(e); process.exit(1); });
