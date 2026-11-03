// npm run seed — creates (or reuses) the demo company and its Celeste demo app, the job catalog and demo sources,
// then runs the pipeline. Idempotent: re-running reuses the company and app, upserts jobs, dedupes sources by content
// hash, and only re-processes sources that are not yet done. Loads .env.local itself (see package.json). Env: SEED_REPO.
import { readFileSync } from "node:fs";
import { serviceDb } from "../src/lib/db/server";
import { enqueueSource } from "../src/lib/ingest/enqueue";
import { processSource } from "../src/lib/pipeline/run";
import { pipelineDeps } from "../src/lib/pipeline/deps";
import { JOBS } from "./demo/celeste";
import { datedFromToday } from "./demo/snapshot";
import { ensureDemoApp, ensureDemoOrg } from "./lib/demo-app";
import { assertNotProd } from "./lib/guard";

async function main() {
  assertNotProd("seed");
  const db = serviceDb();
  const orgId = await ensureDemoOrg(db);
  const projectId = await ensureDemoApp(db, orgId, process.env.SEED_REPO || null);

  const jobsRes = await db.from("jobs").upsert(JOBS.map((j) => ({ ...j, project_id: projectId })), { onConflict: "project_id,code" });
  if (jobsRes.error) throw new Error(jobsRes.error.message);

  // Dated relative to today (datedFromToday), so the demo's feedback reads as current whenever it is seeded.
  const sources = datedFromToday(JSON.parse(readFileSync("eval/fixtures/sources.json", "utf8")) as { kind: string; author: string; channel: string; occurred_at: string; raw_text: string }[]);
  for (const s of sources) {
    const r = await enqueueSource(projectId, { kind: s.kind, raw_text: s.raw_text, author: s.author, channel: s.channel, occurred_at: s.occurred_at, demo: true });
    // processSource claims the source atomically and returns at once if it is already done or owned elsewhere.
    console.log(r.duplicate ? "existing" : "queued", s.author);
    try { await processSource(pipelineDeps(), r.id); } catch (e) { console.error("failed", s.author, (e as Error).message); }
  }
  const st = await db.from("sources").select("status").eq("project_id", projectId);
  const counts: Record<string, number> = {};
  for (const row of st.data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  console.log("Source statuses", counts);
  console.log("Seeded project", projectId);
}
main().catch((e) => { console.error(e); process.exit(1); });
