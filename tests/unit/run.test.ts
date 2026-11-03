import { describe, it, expect, vi } from "vitest";
import { DEMO_PRODUCT } from "@/lib/product/profile";
import { processSource, rescoreIssue } from "@/lib/pipeline/run";
import type { PipelineRepo, IssueForScoring, SourceRow } from "@/lib/pipeline/repo";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "@/lib/types";

function memRepo(opts: { claim?: boolean; source?: Partial<SourceRow> } = {}) {
  const issues = new Map<string, IssueForScoring>();
  const units: { id: string; sourceId: string; issueId?: string; quote: string; type: string; severity_signals?: Record<string, boolean>; occurred_at: string }[] = [];
  const scores: { importance: number; breakdown: unknown }[] = [];
  const status: string[] = [];
  const errors: (string | undefined)[] = [];
  const transcripts: { id: string; text: string; metadata: Record<string, unknown> }[] = [];
  const activity: { issueId: string; kind: string; payload: Record<string, unknown> }[] = [];
  const unitScreens: { unitId: string; screen_id: string; confidence: number; evidence: string }[] = [];
  const created: { embedding: number[] | null; last_reported_at: string }[] = [];
  const inserted: { embedding: number[] | null; occurred_at: string }[] = [];
  let unitSeq = 0;
  let issueSeq = 0;
  const repo: PipelineRepo = {
    getSource: async () => ({ id: "src", project_id: "p", raw_text: "Parent: It showed a spinner and went back to Home. Nothing sent.\nParent: I love the reply speed.", author: "Jordan", channel: "call", route: null, occurred_at: new Date().toISOString(), kind: "paste", file_path: null, metadata: {}, ...opts.source }),
    saveTranscript: async (id, text, metadata) => { transcripts.push({ id, text, metadata }); },
    claimSource: async () => { if (opts.claim === false) return false; status.push("processing"); return true; },
    setSourceStatus: async (_id, s, e) => { status.push(s); errors.push(e); },
    getProjectContext: async () => ({ jobs: [], routeMap: {}, weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, fewShots: "", product: DEMO_PRODUCT }),
    getScreenByFrame: async () => null,
    resetSourceUnits: async (sourceId) => {
      const gone = units.filter((u) => u.sourceId === sourceId);
      const issueIds = [...new Set(gone.flatMap((u) => (u.issueId ? [u.issueId] : [])))];
      for (const u of gone) {
        const iss = u.issueId ? issues.get(u.issueId) : undefined;
        if (iss) iss.units = iss.units.filter((x) => (x as { id?: string }).id !== u.id);
        units.splice(units.indexOf(u), 1);
      }
      return issueIds;
    },
    deleteIssueIfEmpty: async (id) => {
      const iss = issues.get(id);
      if (!iss || iss.units.length > 0) return false;
      issues.delete(id);
      return true;
    },
    insertUnits: async (sourceId, _p, us) => us.map((u) => { inserted.push(u); const id = `u${unitSeq++}`; units.push({ id, sourceId, quote: u.quote, type: u.type, severity_signals: u.severity_signals, occurred_at: u.occurred_at }); return { id }; }),
    matchScreens: async () => [{ id: "s1", frame_id: "pickup/notify", scene: "pickup", title: "Notify", description: null, copy_text: null, similarity: 0.9 }],
    matchIssues: async () => [],
    listScreens: async () => [{ id: "s1", frame_id: "pickup/notify", scene: "pickup", title: "Notify", description: null, copy_text: null, similarity: null }],
    listOpenIssues: async () => [...issues.values()].map((i) => ({ id: i.id, title: i.title, problem_statement: i.problem_statement, type: i.type, similarity: null })),
    createIssue: async (_p, d) => { created.push(d); const id = `i${issueSeq++}`; issues.set(id, { id, title: d.title, problem_statement: d.problem_statement, type: d.type as "bug", lane: null, importance: null, breakdown: null, units: [], screens: [] }); return id; },
    attachUnit: async (unitId, issueId, screens) => {
      const u = units.find((x) => x.id === unitId)!; u.issueId = issueId;
      const iss = issues.get(issueId)!;
      iss.units.push({ id: u.id, quote: u.quote, speakers: ["Jordan"], corroborators: [], reported_count: 0, sentiment: -2, emotion: "frustrated", severity_signals: u.severity_signals ?? null, occurred_at: u.occurred_at } as IssueForScoring["units"][number]);
      iss.screens.push(...screens.map((s) => ({ frame_id: "pickup/notify", confidence: s.confidence })));
    },
    mapUnitScreens: async (unitId, screens) => { unitScreens.push(...screens.map((s) => ({ unitId, ...s }))); },
    getIssueForScoring: async (id) => structuredClone(issues.get(id)!),
    saveScores: async (id, s) => { const iss = issues.get(id)!; iss.lane = s.lane; iss.importance = s.importance; iss.breakdown = s.breakdown as IssueForScoring["breakdown"]; scores.push(s); },
    logActivity: async (issueId, kind, payload) => { activity.push({ issueId, kind, payload }); },
  };
  return { repo, issues, units, status, errors, transcripts, activity, unitScreens, created, inserted, scores };
}

const EXTRACT = { units: [{ quote: "It showed a spinner and went back to Home. Nothing sent.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null }] };
const CLASSIFY = { items: [{ index: 0, type: "bug", sentiment: -2, emotion: "frustrated", audience: "parents", job_code: null, signals: { blocks_task: true, has_workaround: true, data_loss: false, frequency_words: false } }] };
const MAP = { screens: [{ frame_id: "pickup/notify", confidence: 0.9, evidence: "spinner after send" }] };
const CREATE = (title: string) => ({ decision: "create", issue_id: null, title, problem_statement: "Send shows a spinner then returns Home without sending." });
const RATE = { severity: 5, clarity: 5, scope: "single_screen", reach: 1, rationale: { severity: "blocks", clarity: "clear", scope: "one screen" } };
const embed = async (t: string[]) => t.map(() => [0.1]);

describe("processSource", () => {
  it("creates an issue for the bug, keeps praise off the board, and fires the lane hook once", async () => {
    const { repo, issues, units, status } = memRepo();
    // Fake LLM answers in call order: extract, classify, map (bug), cluster, map (praise), rate.
    const answers = [
      { units: [
        { quote: "It showed a spinner and went back to Home. Nothing sent.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null },
        { quote: "I love the reply speed.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null },
      ] },
      { items: [
        { index: 0, type: "bug", sentiment: -2, emotion: "frustrated", audience: "parents", job_code: null, signals: { blocks_task: true, has_workaround: true, data_loss: false, frequency_words: false } },
        { index: 1, type: "praise", sentiment: 2, emotion: "delighted", audience: "parents", job_code: null, signals: { blocks_task: false, has_workaround: false, data_loss: false, frequency_words: false } },
      ] },
      { screens: [{ frame_id: "pickup/notify", confidence: 0.9, evidence: "spinner after send" }] },
      { decision: "create", issue_id: null, title: "Early pickup fails silently", problem_statement: "Send shows a spinner then returns Home without sending." },
      { screens: [{ frame_id: "pickup/notify", confidence: 0.8, evidence: "reply speed" }] },
      { severity: 5, clarity: 5, scope: "single_screen", reach: 1, rationale: { severity: "blocks", clarity: "clear", scope: "one screen" } },
    ];
    const fake = vi.fn(async () => answers.shift());
    const onLaneEntered = vi.fn(async () => {});
    await processSource({ repo, llm: fake as never, embed: async (t) => t.map(() => [0.1]), onLaneEntered }, "src");
    // The praise unit adds one screen-mapping call (6 = extract, classify, map, cluster, map praise, rate).
    expect(fake).toHaveBeenCalledTimes(6);
    expect(status).toEqual(["processing", "done"]);
    expect(units).toHaveLength(2);
    expect(units.find((u) => u.type === "praise")!.issueId).toBeUndefined();
    expect([...issues.values()][0].title).toBe("Early pickup fails silently");
    expect([...issues.values()][0].lane).toBe("quick_win");
    expect(onLaneEntered).toHaveBeenCalledWith("i0", "quick_win");
  });

  it("maps a praise unit to screens without attaching it to an issue", async () => {
    const { repo, issues, units, unitScreens } = memRepo();
    const matchScreens = vi.fn(repo.matchScreens);
    repo.matchScreens = matchScreens;
    const answers: unknown[] = [
      { units: [{ quote: "I love the reply speed.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null }] },
      { items: [{ index: 0, type: "praise", sentiment: 2, emotion: "delighted", audience: "parents", job_code: null, signals: { blocks_task: false, has_workaround: false, data_loss: false, frequency_words: false } }] },
      { screens: [{ frame_id: "pickup/notify", confidence: 0.8, evidence: "reply speed" }, { frame_id: "pickup/notify", confidence: 0.2, evidence: "weak" }] },
    ];
    const llm = vi.fn(async () => answers.shift());
    const embedSpy = vi.fn(async (t: string[]) => t.map(() => [0.1]));
    await processSource({ repo, llm: llm as never, embed: embedSpy, onLaneEntered: async () => {} }, "src");
    expect(llm).toHaveBeenCalledTimes(3);
    expect(embedSpy.mock.calls[0][0]).toEqual(["I love the reply speed."]);
    expect(matchScreens).toHaveBeenCalledTimes(1);
    expect(unitScreens).toEqual([{ unitId: units[0].id, screen_id: "s1", confidence: 0.8, evidence: "reply speed" }]);
    expect(units[0].issueId).toBeUndefined();
    expect(issues.size).toBe(0);
  });

  it("maps a praise unit by widget route without an LLM mapping call", async () => {
    const { repo, units, unitScreens } = memRepo();
    const base = repo.getSource;
    repo.getSource = async (id) => ({ ...(await base(id)), route: "/pickup/notify?x=1" });
    repo.getProjectContext = async () => ({ jobs: [], routeMap: { "/pickup": "pickup/notify" }, weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, fewShots: "", product: DEMO_PRODUCT });
    repo.getScreenByFrame = async () => ({ id: "s1", frame_id: "pickup/notify", scene: "pickup", title: null, description: null, copy_text: null, similarity: 1 });
    const answers: unknown[] = [
      { units: [{ quote: "I love the reply speed.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null }] },
      { items: [{ index: 0, type: "praise", sentiment: 2, emotion: "delighted", audience: "parents", job_code: null, signals: { blocks_task: false, has_workaround: false, data_loss: false, frequency_words: false } }] },
    ];
    const llm = vi.fn(async () => answers.shift());
    await processSource({ repo, llm: llm as never, embed, onLaneEntered: async () => {} }, "src");
    expect(llm).toHaveBeenCalledTimes(2);
    expect(unitScreens).toEqual([{ unitId: units[0].id, screen_id: "s1", confidence: 0.95, evidence: "widget route /pickup/notify?x=1" }]);
  });

  it("logs feedback_added per attached unit and hands the touched issues to onFiled before scoring", async () => {
    const { repo, activity } = memRepo();
    const order: string[] = [];
    const save = repo.saveScores;
    repo.saveScores = async (id, s) => { order.push("score"); await save(id, s); };
    const ok = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const onFiled = vi.fn(async () => { order.push("filed"); });
    await processSource({ repo, llm: (async () => ok.shift()) as never, embed, onLaneEntered: async () => {}, onFiled }, "src");
    expect(activity.filter((a) => a.kind === "feedback_added")).toEqual([
      { issueId: "i0", kind: "feedback_added", payload: { quote: EXTRACT.units[0].quote, author: "Jordan", created: true, source_id: "src" } },
    ]);
    expect(onFiled).toHaveBeenCalledWith("src", ["i0"]);
    expect(order).toEqual(["filed", "score"]);
  });
  it("hands the touched issues to onProcessed once scoring is saved, so Slack cards show the final numbers", async () => {
    const { repo } = memRepo();
    const order: string[] = [];
    const save = repo.saveScores;
    repo.saveScores = async (id, s) => { order.push("score"); await save(id, s); };
    const ok = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const onProcessed = vi.fn(async () => { order.push("processed"); });
    await processSource({ repo, llm: (async () => ok.shift()) as never, embed, onLaneEntered: async () => {}, onProcessed }, "src");
    expect(onProcessed).toHaveBeenCalledWith("src", ["i0"]);
    expect(order).toEqual(["score", "processed"]);
  });
  it("an onProcessed failure never fails the source", async () => {
    const { repo, status } = memRepo();
    const ok = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: (async () => ok.shift()) as never, embed, onLaneEntered: async () => {}, onProcessed: async () => { throw new Error("slack down"); } }, "src");
    expect(status).toEqual(["processing", "done"]);
  });
  it("marks joining an existing issue as not created", async () => {
    const { repo, activity, issues } = memRepo();
    issues.set("old", { id: "old", title: "Early pickup fails", problem_statement: "x", type: "bug", lane: null, importance: null, breakdown: null, units: [], screens: [] });
    repo.matchIssues = async () => [{ id: "old", title: "Early pickup fails", problem_statement: "x", type: "bug", similarity: 0.9 }] as never;
    const ok = [EXTRACT, CLASSIFY, MAP, { decision: "attach", issue_id: "old", title: null, problem_statement: null }, RATE];
    await processSource({ repo, llm: (async () => ok.shift()) as never, embed, onLaneEntered: async () => {} }, "src");
    expect(activity.find((a) => a.kind === "feedback_added")).toMatchObject({ issueId: "old", payload: { created: false } });
  });
  it("still reports a source with nothing actionable, and an onFiled failure never fails the source", async () => {
    const { repo, status } = memRepo();
    const answers: unknown[] = [{ units: [{ quote: "Lunch was nice.", speakers: [], corroborators: [], reported_count: 0, relevant: false, filtered_reason: "off-topic" }] }, { items: [] }];
    const onFiled = vi.fn(async () => { throw new Error("slack down"); });
    await processSource({ repo, llm: (async () => answers.shift()) as never, embed, onLaneEntered: async () => {}, onFiled }, "src");
    expect(onFiled).toHaveBeenCalledWith("src", []);
    expect(status).toEqual(["processing", "done"]);
  });

  it("without an embedder (no Voyage key), maps against every screen and clusters against the open issues", async () => {
    const { repo, created, inserted, issues } = memRepo();
    const matchScreens = vi.fn(repo.matchScreens), matchIssues = vi.fn(repo.matchIssues);
    const listScreens = vi.fn(repo.listScreens), listOpenIssues = vi.fn(repo.listOpenIssues);
    Object.assign(repo, { matchScreens, matchIssues, listScreens, listOpenIssues });
    const ok = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: (async () => ok.shift()) as never, embed: null, onLaneEntered: async () => {} }, "src");
    expect(matchScreens).not.toHaveBeenCalled();
    expect(matchIssues).not.toHaveBeenCalled();
    expect(listScreens).toHaveBeenCalledWith("p", 80);
    expect(listOpenIssues).toHaveBeenCalledWith("p", 60);
    expect(created).toEqual([expect.objectContaining({ embedding: null })]);
    expect(inserted.every((u) => u.embedding === null)).toBe(true);
    expect([...issues.values()][0].screens).toEqual([{ frame_id: "pickup/notify", confidence: 0.9 }]);
  });
  it("without an embedder, a second report joins the issue Claude picks from the full list", async () => {
    const { repo, issues, activity } = memRepo();
    const first = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: (async () => first.shift()) as never, embed: null, onLaneEntered: async () => {} }, "src");
    const prompts: string[] = [];
    const second = [EXTRACT, CLASSIFY, MAP, { decision: "attach", issue_id: "i0", title: null, problem_statement: null }, RATE];
    await processSource({ repo, llm: (async (a: { user: string }) => { prompts.push(a.user); return second.shift(); }) as never, embed: null, onLaneEntered: async () => {} }, "src");
    expect(prompts.some((u) => u.includes("id=i0") && u.includes("Early pickup fails silently"))).toBe(true);
    expect(issues.size).toBe(1);
    expect(activity.filter((a) => a.kind === "feedback_added").map((a) => a.payload.created)).toEqual([true, false]);
  });

  it("marks the source failed with the error and rethrows nothing", async () => {
    const { repo, status } = memRepo();
    const fake = vi.fn(async () => { throw new Error("boom"); });
    await processSource({ repo, llm: fake as never, embed: async () => [], onLaneEntered: async () => {} }, "src");
    expect(status).toEqual(["processing", "failed"]);
  });
  it("does not attach screens with confidence below 0.5 (Unmapped)", async () => {
    const { repo, issues } = memRepo();
    const attach = vi.fn(repo.attachUnit);
    repo.attachUnit = attach;
    const answers = [
      { units: [{ quote: "It showed a spinner and went back to Home. Nothing sent.", speakers: ["Jordan"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null }] },
      { items: [{ index: 0, type: "bug", sentiment: -2, emotion: "frustrated", audience: "parents", job_code: null, signals: { blocks_task: true, has_workaround: true, data_loss: false, frequency_words: false } }] },
      { screens: [{ frame_id: "pickup/notify", confidence: 0.3, evidence: "weak match" }] },
      { decision: "create", issue_id: null, title: "Early pickup fails silently", problem_statement: "Send shows a spinner then returns Home without sending." },
      { severity: 5, clarity: 5, scope: "single_screen", reach: 1, rationale: { severity: "blocks", clarity: "clear", scope: "one screen" } },
    ];
    const fake = vi.fn(async () => answers.shift());
    await processSource({ repo, llm: fake as never, embed: async (t) => t.map(() => [0.1]), onLaneEntered: async () => {} }, "src");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][2]).toEqual([]);
    expect(issues.size).toBe(1);
  });
  it("does nothing when the source cannot be claimed", async () => {
    const { repo, status } = memRepo({ claim: false });
    const fake = vi.fn();
    await processSource({ repo, llm: fake as never, embed, onLaneEntered: async () => {} }, "src");
    expect(fake).not.toHaveBeenCalled();
    expect(status).toEqual([]);
  });

  it("is idempotent when retried after a failure inside clustering", async () => {
    const single = memRepo();
    const ok = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo: single.repo, llm: (async () => ok.shift()) as never, embed, onLaneEntered: async () => {} }, "src");

    const { repo, units, issues, status } = memRepo();
    const first: unknown[] = [EXTRACT, CLASSIFY, MAP];
    let failing = true;
    const llm = vi.fn(async () => {
      if (first.length) return first.shift();
      if (failing) { failing = false; throw new Error("cluster boom"); }
      return undefined;
    });
    await processSource({ repo, llm: llm as never, embed, onLaneEntered: async () => {} }, "src");
    expect(status).toEqual(["processing", "failed"]);
    const retry: unknown[] = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: (async () => retry.shift()) as never, embed, onLaneEntered: async () => {} }, "src");
    expect(status).toEqual(["processing", "failed", "processing", "done"]);
    expect(units).toHaveLength(single.units.length);
    const bugIssue = [...issues.values()];
    expect(bugIssue).toHaveLength(1);
    expect(bugIssue[0].units.filter((u) => u.quote.startsWith("It showed a spinner"))).toHaveLength(1);
  });

  it("deletes an issue emptied by the reset when the retry clusters elsewhere", async () => {
    const { repo, issues } = memRepo();
    const firstRun: unknown[] = [EXTRACT, CLASSIFY, MAP, CREATE("Old issue")];
    // Rating fails after the issue was created and the unit attached.
    const llm1 = vi.fn(async () => { if (firstRun.length) return firstRun.shift(); throw new Error("rate boom"); });
    await processSource({ repo, llm: llm1 as never, embed, onLaneEntered: async () => {} }, "src");
    expect([...issues.keys()]).toEqual(["i0"]);
    const retry: unknown[] = [EXTRACT, CLASSIFY, MAP, CREATE("New issue"), RATE];
    await processSource({ repo, llm: (async () => retry.shift()) as never, embed, onLaneEntered: async () => {} }, "src");
    expect([...issues.keys()]).toEqual(["i1"]);
    expect(issues.get("i1")!.title).toBe("New issue");
  });

  it("completes the source and logs lane_action_failed when onLaneEntered throws", async () => {
    const { repo, status, activity } = memRepo();
    const answers: unknown[] = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const onLaneEntered = vi.fn(async () => { throw new Error("hook down"); });
    await processSource({ repo, llm: (async () => answers.shift()) as never, embed, onLaneEntered }, "src");
    expect(onLaneEntered).toHaveBeenCalledWith("i0", "quick_win");
    expect(status).toEqual(["processing", "done"]);
    expect(activity.find((a) => a.kind === "lane_action_failed")?.payload).toEqual({ lane: "quick_win", error: "hook down" });
  });

  it("rescoreIssue on a zero-unit issue makes no LLM call", async () => {
    const { repo, issues } = memRepo();
    issues.set("i9", { id: "i9", title: "t", problem_statement: "p", type: "bug", lane: "watch", importance: null, breakdown: null, units: [], screens: [] });
    const llm = vi.fn();
    const r = await rescoreIssue({ repo, llm: llm as never, embed, onLaneEntered: async () => {} }, "p", "i9");
    expect(llm).not.toHaveBeenCalled();
    expect(r).toEqual({ lane: "watch", changed: false });
  });
});

describe("processSource with recordings", () => {
  const transcript = { text: "Participants: Priya Shah (parent)\n\nPriya Shah: It showed a spinner and went back to Home. Nothing sent.", speakers: [{ label: "Speaker 0", name: "Priya Shah", role: "parent" as const }], durationSec: 92 };
  const audio = { kind: "audio", raw_text: "", file_path: "p/audio/abc.mp3", metadata: { filename: "call.mp3" } };

  it("transcribes an audio source once, saves the transcript, and extracts from it", async () => {
    const { repo, status, transcripts } = memRepo({ source: audio });
    const answers = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const fake = vi.fn<(o: { user: unknown }) => Promise<unknown>>(async () => answers.shift());
    const transcribe = vi.fn(async () => transcript);
    await processSource({ repo, llm: fake as never, embed, onLaneEntered: async () => {}, transcribe }, "src");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcripts).toEqual([{ id: "src", text: transcript.text, metadata: { filename: "call.mp3", transcript: { speakers: transcript.speakers, durationSec: 92 } } }]);
    expect(String(fake.mock.calls[0][0].user)).toContain("Priya Shah: It showed a spinner");
    expect(status).toEqual(["processing", "done"]);
  });

  it("reuses the saved transcript when a recording is retried", async () => {
    const { repo, status } = memRepo({ source: { ...audio, raw_text: transcript.text } });
    const answers = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const transcribe = vi.fn(async () => transcript);
    await processSource({ repo, llm: vi.fn(async () => answers.shift()) as never, embed, onLaneEntered: async () => {}, transcribe }, "src");
    expect(transcribe).not.toHaveBeenCalled();
    expect(status).toEqual(["processing", "done"]);
  });

  it("fails a recording with a clear message when nothing can transcribe it", async () => {
    const { repo, status, errors } = memRepo({ source: audio });
    const fake = vi.fn();
    await processSource({ repo, llm: fake as never, embed, onLaneEntered: async () => {} }, "src");
    expect(fake).not.toHaveBeenCalled();
    expect(status).toEqual(["processing", "failed"]);
    expect(errors.at(-1)).toMatch(/DEEPGRAM_API_KEY/);
  });
});

describe("rescoreIssue explains the priority", () => {
  const deps = (repo: PipelineRepo, llm: unknown) => ({ repo, llm: llm as never, embed, onLaneEntered: async () => {} });
  const unit = (speaker: string, at = new Date().toISOString()) => ({ quote: "It never sends", speakers: [speaker], corroborators: [], reported_count: 0, sentiment: -2, emotion: "frustrated", severity_signals: { blocks_task: true, has_workaround: false, data_loss: false, frequency_words: false }, occurred_at: at });

  it("stores the inputs, the points and the signals, and logs the first score", async () => {
    const { repo, scores, activity } = memRepo();
    const answers = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    const llm = vi.fn<(o: { user: unknown }) => Promise<unknown>>(async () => answers.shift());
    await processSource(deps(repo, llm), "src");
    const b = scores[0].breakdown as { inputs: Record<string, unknown>; points: Record<string, number>; signals: Record<string, number> };
    expect(b.inputs).toMatchObject({ severity: 5, reach: 1, peopleCount: 1, distinctPeople: 1, reportedByOthers: 0, frustrated: true, meanSentiment: -2 });
    expect(typeof b.inputs.lastReportAt).toBe("string");
    expect(Object.values(b.points).reduce((a, n) => a + n, 0)).toBe(scores[0].importance);
    expect(b.signals).toEqual({ blocks_task: 1, has_workaround: 1, data_loss: 0, frequency_words: 0, of: 1 });
    expect(activity.find((a) => a.kind === "priority_changed")?.payload).toEqual({ from: null, to: scores[0].importance, reason: "First scored" });
    expect(String(llm.mock.calls.at(-1)![0].user)).toContain("1 of 1 says it blocks them");
  });

  it("logs a change of 3 or more with what moved it", async () => {
    const { repo, issues, activity } = memRepo();
    const prev = { severity: 5, reach: 1, peopleCount: 1, distinctPeople: 1, reportedByOthers: 0, meanSentiment: -2, frustrated: true, lastReportAt: new Date().toISOString() };
    issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: "quick_win", importance: 86, breakdown: { inputs: prev }, units: [unit("Priya"), unit("Tom"), unit("Elena")], screens: [] });
    await rescoreIssue(deps(repo, vi.fn(async () => RATE)), "p", "i1");
    const change = activity.find((a) => a.kind === "priority_changed")!.payload;
    expect(change).toMatchObject({ from: 86, reason: "2 more people" });
    expect(Number(change.to)).toBeGreaterThanOrEqual(89);
  });

  it("does not log small wobbles", async () => {
    const { repo, issues, activity } = memRepo();
    const prev = { severity: 5, reach: 1, peopleCount: 1, distinctPeople: 1, reportedByOthers: 0, meanSentiment: -2, frustrated: true, lastReportAt: new Date().toISOString() };
    issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: "quick_win", importance: 85, breakdown: { inputs: prev }, units: [unit("Priya")], screens: [] });
    await rescoreIssue(deps(repo, vi.fn(async () => RATE)), "p", "i1");
    expect(activity.some((a) => a.kind === "priority_changed")).toBe(false);
  });
});

describe("report dates follow when the feedback happened, not when it was filed", () => {
  const DAY = 86_400_000;
  const OLD = new Date(Date.now() - 20 * DAY).toISOString();

  it("stamps each piece and a new issue with the source's date, and scores from it", async () => {
    const { repo, inserted, created, scores } = memRepo({ source: { occurred_at: OLD } });
    const answers = [EXTRACT, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: vi.fn(async () => answers.shift()) as never, embed, onLaneEntered: async () => {} }, "src");
    expect(inserted.map((u) => u.occurred_at)).toEqual([OLD]);
    expect(created[0].last_reported_at).toBe(OLD);
    expect((scores[0].breakdown as { inputs: { lastReportAt: string } }).inputs.lastReportAt).toBe(OLD);
  });

  it("counts this week's reports by when they happened", async () => {
    const MID = { severity: 3, clarity: 5, scope: "single_screen", reach: 0.5, rationale: { severity: "slows", clarity: "clear", scope: "one screen" } };
    const unit = (speaker: string, at: string) => ({ quote: "q", speakers: [speaker], corroborators: [], reported_count: 0, sentiment: -2, emotion: "frustrated", severity_signals: null, occurred_at: at });
    const laneFor = async (at: string) => {
      const { repo, issues } = memRepo();
      issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: null, importance: null, breakdown: null, units: [unit("Priya", at), unit("Tom", at)], screens: [] });
      return (await rescoreIssue({ repo, llm: vi.fn(async () => MID) as never, embed, onLaneEntered: async () => {} }, "p", "i1")).lane;
    };
    expect(await laneFor(new Date().toISOString())).toBe("watch");
    expect(await laneFor(new Date(Date.now() - 10 * DAY).toISOString())).toBe("backlog");
  });
});

describe("rescoreIssue hands the new score to alerts", () => {
  const prev = { severity: 5, reach: 1, peopleCount: 1, distinctPeople: 1, reportedByOthers: 0, meanSentiment: -2, frustrated: true, lastReportAt: new Date().toISOString() };
  const unit = (speaker: string) => ({ quote: "q", speakers: [speaker], corroborators: [], reported_count: 0, sentiment: -2, emotion: "frustrated", severity_signals: { blocks_task: true, has_workaround: false, data_loss: false, frequency_words: false }, occurred_at: new Date().toISOString() });

  it("calls onScored after the score and its priority_changed row are saved", async () => {
    const { repo, issues, activity } = memRepo();
    issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: "quick_win", importance: 70, breakdown: { inputs: prev }, units: [unit("Priya"), unit("Tom")], screens: [] });
    const seen: number[] = [];
    const onScored = vi.fn(async () => { seen.push(activity.filter((a) => a.kind === "priority_changed").length); });
    await rescoreIssue({ repo, llm: vi.fn(async () => RATE) as never, embed, onLaneEntered: async () => {}, onScored }, "p", "i1");
    expect(onScored).toHaveBeenCalledWith("i1", expect.objectContaining({ prev: 70, type: "bug", severity: 5, signals: expect.objectContaining({ blocks_task: 2, of: 2 }) }));
    expect(seen).toEqual([1]);
  });

  it("never fails the score when alerting throws", async () => {
    const { repo, issues, activity } = memRepo();
    issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: null, importance: null, breakdown: null, units: [unit("Priya")], screens: [] });
    await rescoreIssue({ repo, llm: vi.fn(async () => RATE) as never, embed, onLaneEntered: async () => {}, onScored: async () => { throw new Error("slack down"); } }, "p", "i1");
    expect(issues.get("i1")!.importance).toBeGreaterThan(0);
    expect(activity.find((a) => a.kind === "lane_action_failed")?.payload).toEqual({ lane: "alerts", error: "slack down" });
  });
});

describe("feedback_added names who said it", () => {
  it("uses the speaker, not whoever added the source (one recording, several parents)", async () => {
    const { repo, activity } = memRepo({ source: { author: "Ms. Rivera" } });
    const extract = { units: [{ ...EXTRACT.units[0], speakers: ["Tom Okafor"] }] };
    const answers = [extract, CLASSIFY, MAP, CREATE("Early pickup fails silently"), RATE];
    await processSource({ repo, llm: vi.fn(async () => answers.shift()) as never, embed, onLaneEntered: async () => {} }, "src");
    expect(activity.find((a) => a.kind === "feedback_added")?.payload.author).toBe("Tom Okafor");
  });
});

describe("rating stays anchored", () => {
  it("shows the model the previous rating so new reports don't make it drift", async () => {
    const { repo, issues } = memRepo();
    const prev = { severity: 5, reach: 1, clarity: 5, scope: "single_screen", rationale: { severity: "blocks" } };
    issues.set("i1", { id: "i1", title: "t", problem_statement: "p", type: "bug", lane: "quick_win", importance: 86, breakdown: prev as never, units: [{ quote: "q", speakers: ["A"], corroborators: [], reported_count: 0, sentiment: -2, emotion: "frustrated", severity_signals: null, occurred_at: new Date().toISOString() }], screens: [] });
    const llm = vi.fn<(o: { user: unknown }) => Promise<unknown>>(async () => RATE);
    await rescoreIssue({ repo, llm: llm as never, embed, onLaneEntered: async () => {} }, "p", "i1");
    expect(String(llm.mock.calls[0][0].user)).toContain("Previous rating: severity 5, reach 1, clarity 5, scope single_screen");
  });
});
