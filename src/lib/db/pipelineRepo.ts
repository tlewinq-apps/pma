import { serviceDb } from "./server";
import type { PipelineRepo } from "@/lib/pipeline/repo";
import type { ScreenCandidate } from "@/lib/pipeline/mapScreens";
import type { IssueCandidate } from "@/lib/pipeline/cluster";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type Thresholds, type Weights } from "@/lib/types";
import { productOf } from "@/lib/product/profile";

const vec = (v: number[]) => `[${v.join(",")}]`;

export function supabasePipelineRepo(): PipelineRepo {
  const db = serviceDb();
  const must = <T>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };
  return {
    async getSource(id) { return must(await db.from("sources").select("id,project_id,raw_text,author,channel,route,occurred_at,kind,file_path,metadata").eq("id", id).single()); },
    async saveTranscript(id, text, metadata) { must(await db.from("sources").update({ raw_text: text, metadata }).eq("id", id).select("id")); },
    async claimSource(id) { return must(await db.rpc("claim_source", { p_id: id })) as boolean; },
    async setSourceStatus(id, status, error) {
      must(await db.from("sources").update({ status, error: error ?? null, locked_at: null }).eq("id", id).select("id"));
    },
    async resetSourceUnits(sourceId) {
      const rows = must(await db.from("feedback_units").select("issue_id").eq("source_id", sourceId)) as { issue_id: string | null }[];
      const ids = [...new Set(rows.flatMap((r) => (r.issue_id ? [r.issue_id] : [])))];
      must(await db.from("feedback_units").delete().eq("source_id", sourceId).select("id"));
      return ids;
    },
    async deleteIssueIfEmpty(issueId) {
      const c = await db.from("feedback_units").select("id", { count: "exact", head: true }).eq("issue_id", issueId);
      if (c.error) throw new Error(c.error.message);
      if ((c.count ?? 0) > 0) return false;
      must(await db.from("issues").delete().eq("id", issueId).select("id"));
      return true;
    },
    async getProjectContext(projectId) {
      const p = must(await db.from("projects").select("route_map,score_weights,thresholds,kind,product_profile,name").eq("id", projectId).single()) as {
        route_map: Record<string, string>; score_weights: Weights | null; thresholds: Thresholds | null; kind: string; product_profile: unknown; name: string;
      };
      const jobs = must(await db.from("jobs").select("id,code,title").eq("project_id", projectId)) as { id: string; code: string; title: string }[];
      const fixes = must(await db.from("label_corrections").select("new_value,old_value,field,feedback_units(quote)").eq("project_id", projectId).order("at", { ascending: false }).limit(20)) as unknown as { new_value: string; old_value: string | null; field: string; feedback_units: { quote: string } | null }[];
      const fewShots = fixes.map((f) => `"${f.feedback_units?.quote ?? ""}" → ${f.field} = ${f.new_value} (not ${f.old_value ?? "?"})`).join("\n");
      return { jobs, routeMap: p.route_map ?? {}, weights: p.score_weights ?? DEFAULT_WEIGHTS, thresholds: p.thresholds ?? DEFAULT_THRESHOLDS, fewShots, product: productOf(p) };
    },
    async getScreenByFrame(projectId, frameId) {
      const r = await db.from("screens").select("id,frame_id,scene,title,description,copy_text").eq("project_id", projectId).eq("frame_id", frameId).maybeSingle();
      return r.data ? { ...r.data, similarity: 1 } : null;
    },
    async insertUnits(sourceId, projectId, units) {
      return must(await db.from("feedback_units").insert(units.map((u) => ({ ...u, source_id: sourceId, project_id: projectId, embedding: u.embedding ? vec(u.embedding) : null }))).select("id"));
    },
    async matchScreens(projectId, embedding, k) { return must(await db.rpc("match_screens", { p_project: projectId, p_embedding: vec(embedding), p_k: k })); },
    async matchIssues(projectId, embedding, k, minSim) { return must(await db.rpc("match_issues", { p_project: projectId, p_embedding: vec(embedding), p_k: k, p_min_sim: minSim })); },
    async listScreens(projectId, limit) {
      const rows = must(await db.from("screens").select("id,frame_id,scene,title,description,copy_text").eq("project_id", projectId).order("frame_id").limit(limit)) as Omit<ScreenCandidate, "similarity">[];
      return rows.map((r) => ({ ...r, similarity: null }));
    },
    async listOpenIssues(projectId, limit) {
      const rows = must(await db.from("issues").select("id,title,problem_statement,type").eq("project_id", projectId).neq("status", "dismissed").order("updated_at", { ascending: false }).limit(limit)) as Omit<IssueCandidate, "similarity">[];
      return rows.map((r) => ({ ...r, similarity: null }));
    },
    async createIssue(projectId, d) {
      let jobId: string | null = null;
      if (d.job_code) jobId = (await db.from("jobs").select("id").eq("project_id", projectId).eq("code", d.job_code).maybeSingle()).data?.id ?? null;
      const row = must(await db.from("issues").insert({ project_id: projectId, title: d.title, problem_statement: d.problem_statement, type: d.type, job_id: jobId, embedding: d.embedding ? vec(d.embedding) : null, last_reported_at: d.last_reported_at }).select("id").single()) as { id: string };
      return row.id;
    },
    async attachUnit(unitId, issueId, screens) {
      const [unit] = must(await db.from("feedback_units").update({ issue_id: issueId }).eq("id", unitId).select("occurred_at")) as { occurred_at: string }[];
      if (screens.length) {
        must(await db.from("unit_screens").upsert(screens.map((s) => ({ unit_id: unitId, ...s }))).select("unit_id"));
        const existing = must(await db.from("issue_screens").select("screen_id,confidence").eq("issue_id", issueId)) as { screen_id: string; confidence: number }[];
        const best = new Map(existing.map((e) => [e.screen_id, e.confidence]));
        const rows = screens.map((s, i) => ({ issue_id: issueId, screen_id: s.screen_id, position: i, evidence: s.evidence, confidence: Math.max(s.confidence, best.get(s.screen_id) ?? 0) }));
        must(await db.from("issue_screens").upsert(rows).select("issue_id"));
      }
      must(await db.from("issues").update({ updated_at: new Date().toISOString() }).eq("id", issueId).select("id"));
      // The later of what's stored and when this piece happened, in one conditional update so a concurrent attach of a
      // newer piece is never overwritten by an older one.
      if (unit) must(await db.from("issues").update({ last_reported_at: unit.occurred_at }).eq("id", issueId).lt("last_reported_at", unit.occurred_at).select("id"));
    },
    async mapUnitScreens(unitId, screens) {
      if (!screens.length) return;
      must(await db.from("unit_screens").upsert(screens.map((s) => ({ unit_id: unitId, ...s }))).select("unit_id"));
    },
    async getIssueForScoring(issueId) {
      const i = must(await db.from("issues").select("id,title,problem_statement,type,lane,importance,breakdown:score_breakdown").eq("id", issueId).single()) as Omit<Awaited<ReturnType<PipelineRepo["getIssueForScoring"]>>, "units" | "screens">;
      const units = must(await db.from("feedback_units").select("quote,speakers,corroborators,reported_count,sentiment,emotion,severity_signals,occurred_at").eq("issue_id", issueId));
      const screens = must(await db.from("issue_screens").select("confidence,screens(frame_id)").eq("issue_id", issueId).order("position")) as unknown as { confidence: number; screens: { frame_id: string } }[];
      return { ...i, units, screens: screens.map((s) => ({ frame_id: s.screens.frame_id, confidence: s.confidence })) } as Awaited<ReturnType<PipelineRepo["getIssueForScoring"]>>;
    },
    async saveScores(issueId, s) {
      must(await db.from("issues").update({ importance: s.importance, ease: s.ease, lane: s.lane, score_breakdown: s.breakdown, people_count: s.people_count, updated_at: new Date().toISOString() }).eq("id", issueId).select("id"));
    },
    async logActivity(issueId, kind, payload) { must(await db.from("activity").insert({ issue_id: issueId, kind, payload }).select("id")); },
  };
}
