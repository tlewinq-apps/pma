import { describe, it, expect, vi } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  CUSTOMER_AUDIENCES, DEMO_AUDIENCES, DEMO_PRODUCT, DEMO_PROFILE, GENERIC_PROFILE, parseProfile, productOf, profileOf, profileOfEmbedded, speakerRolesFor, type ProductProfile,
} from "@/lib/product/profile";
import { PROMPTS, promptsFor } from "@/lib/llm/prompts";
import { ClassifyOut, ExtractOut, classifyOutFor, extractOutFor } from "@/lib/pipeline/schemas";
import { classifyUnits } from "@/lib/pipeline/classify";
import { extractUnits } from "@/lib/pipeline/extract";
import { nameSpeakers } from "@/lib/transcribe/speakers";
import { draftFollowups } from "@/lib/followups";
import { proposeSolutions } from "@/lib/pipeline/solve";
import { processSource } from "@/lib/pipeline/run";
import type { PipelineRepo } from "@/lib/pipeline/repo";
import { AUDIENCE_GROUP, AUDIENCE_ONE, audienceWords } from "@/components/triage/format";
import { analyseIssue, audienceCount, type AnalysisInput } from "@/lib/analysis";
import { audienceNoun, audienceNounPlural } from "@/lib/proposals";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "@/lib/types";

vi.mock("@/lib/db/server", () => ({ serviceDb: () => { throw new Error("no database in unit tests"); }, userDb: async () => { throw new Error("no database in unit tests"); } }));

const closet: ProductProfile = {
  name: "Closet", one_liner: "an AI fashion app where people save clothes and generate styled outfit photos", audience: "shoppers", audience_one: "shopper", platform: "web and mobile",
};
const SCHOOL = /school|parent|northfield/i;
/** The words a schema shows the model: its JSON Schema, descriptions and enums included. */
const schemaText = (s: { toJSONSchema(): unknown }) => JSON.stringify(s.toJSONSchema());
/** The schema exactly as the client sends it (src/lib/llm/client.ts), as plain JSON. */
const outputSchema = (s: Parameters<typeof zodOutputFormat>[0]) => JSON.parse(JSON.stringify(zodOutputFormat(s).schema));

describe("promptsFor", () => {
  it("gives the demo the same prompts as any app, in Celeste's words", () => {
    const demo = promptsFor(DEMO_PROFILE);
    expect(PROMPTS).toEqual(demo);
    expect(Object.keys(demo).sort()).toEqual(Object.keys(promptsFor(closet)).sort());
    for (const [key, text] of Object.entries(demo)) expect(text, key).not.toMatch(SCHOOL);
    for (const key of ["diagnose", "scope", "fit", "steps", "speakers", "followups", "nameProposal"] as const) expect(demo[key], key).toContain(DEMO_PROFILE.one_liner);
    expect(demo.classify).toContain("users = members");
  });

  it("writes a customer app's prompts in its own words, with nothing about a school", () => {
    const p = promptsFor(closet);
    expect(Object.keys(p).sort()).toEqual(Object.keys(PROMPTS).sort());
    for (const [key, text] of Object.entries(p)) expect(text, key).not.toMatch(SCHOOL);
    for (const key of ["diagnose", "scope", "fit", "steps", "speakers", "followups", "nameProposal"] as const) expect(p[key], key).toContain(closet.one_liner);
    expect(p.scope).toContain("how shoppers manage without it");
    expect(p.speakers).toContain("Role: shopper, staff");
    expect(p.classify).toContain("users = shoppers");
  });

  it("keeps the generic profile free of school words too", () => {
    for (const [key, text] of Object.entries(promptsFor(GENERIC_PROFILE))) expect(text, key).not.toMatch(SCHOOL);
  });
});

describe("profileOf", () => {
  it("gives the demo app the Celeste profile, whatever is stored", () => {
    expect(profileOf({ kind: "demo", product_profile: null, name: "Celeste" })).toEqual(DEMO_PROFILE);
    expect(profileOf({ kind: "demo", product_profile: closet, name: "Celeste" })).toEqual(DEMO_PROFILE);
  });

  it("reads a customer app's stored profile", () => {
    expect(profileOf({ kind: "customer", product_profile: closet, name: "Closet app" })).toEqual(closet);
  });

  it("calls an undescribed app's audience people, one of them a person", () => {
    expect([GENERIC_PROFILE.audience, GENERIC_PROFILE.audience_one]).toEqual(["people", "person"]);
    const generic = profileOf({ kind: "customer", product_profile: null, name: "Closet" });
    expect(audienceNoun(["users"], generic)).toBe("person");
    expect(audienceNounPlural(["users"], generic)).toBe("people");
    expect(audienceNounPlural(["users"], closet)).toBe("shoppers");
    expect(audienceNounPlural(["staff"], closet)).toBe("staff members");
    // The demo's header words are Celeste's.
    expect(audienceNounPlural(["users"], DEMO_PROFILE)).toBe("members");
    expect(audienceNounPlural(["staff"], DEMO_PROFILE)).toBe("staff members");
    expect(audienceNounPlural([], DEMO_PROFILE)).toBe("members");
  });

  it("falls back to the generic profile, named after the app, when none is stored or it is malformed", () => {
    const generic = { ...GENERIC_PROFILE, name: "Closet" };
    expect(profileOf({ kind: "customer", product_profile: null, name: "Closet" })).toEqual(generic);
    expect(profileOf({ kind: "customer", product_profile: "an app", name: "Closet" })).toEqual(generic);
    expect(profileOf({ kind: "customer", product_profile: { ...closet, platform: "tv" }, name: "Closet" })).toEqual(generic);
    expect(profileOf({ kind: "customer", product_profile: { ...closet, audience: "  " }, name: "Closet" })).toEqual(generic);
  });
});

describe("parseProfile", () => {
  it("trims the words, drops a trailing full stop and unknown keys", () => {
    expect(parseProfile({ ...closet, one_liner: `  ${closet.one_liner}. `, extra: 1 })).toEqual(closet);
  });
  it("refuses anything missing or too long", () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({ ...closet, name: undefined })).toBeNull();
    expect(parseProfile({ ...closet, one_liner: "x".repeat(400) })).toBeNull();
  });
});

describe("audiences", () => {
  it("lists the same audiences for the demo and everyone else", () => {
    expect(DEMO_AUDIENCES).toEqual(CUSTOMER_AUDIENCES);
    expect(productOf({ kind: "demo", product_profile: null, name: "Celeste" }).audiences).toEqual(CUSTOMER_AUDIENCES);
  });

  it("productOf builds the profile and audiences from one project row", () => {
    expect(productOf({ kind: "demo", product_profile: closet, name: "Celeste" })).toEqual(DEMO_PRODUCT);
    expect(productOf({ kind: "customer", product_profile: closet, name: "Closet" })).toEqual({ profile: closet, audiences: CUSTOMER_AUDIENCES });
  });

  it("refuses to guess the app when an embedded project did not load", () => {
    expect(() => profileOfEmbedded(null, "followups")).toThrow("followups: the issue's app did not load, so its product profile is unknown");
    expect(() => profileOfEmbedded(undefined, "diagnosis")).toThrow(/diagnosis: the issue's app did not load/);
    expect(profileOfEmbedded({ kind: "customer", product_profile: closet, name: "Closet" }, "x")).toEqual(closet);
  });

  it("classifyOutFor only accepts the app's own audiences", () => {
    const item = (audience: string) => ({ items: [{ index: 0, type: "bug", sentiment: -1, emotion: "frustrated", audience, job_code: null, signals: { blocks_task: true, has_workaround: false, data_loss: false, frequency_words: false } }] });
    const customer = classifyOutFor(CUSTOMER_AUDIENCES);
    expect(() => customer.parse(item("parents"))).toThrow();
    expect(customer.parse(item("users")).items[0].audience).toBe("users");
    expect(customer.parse(item("unknown")).items[0].audience).toBe("unknown");
    expect(ClassifyOut.parse(item("users")).items[0].audience).toBe("users");
    expect(() => ClassifyOut.parse(item("parents"))).toThrow();
  });

  it("gives the demo the same classify and extract schemas as any app, in Celeste's words", () => {
    expect(outputSchema(ClassifyOut)).toEqual(outputSchema(classifyOutFor(CUSTOMER_AUDIENCES)));
    expect(outputSchema(ExtractOut)).toEqual(outputSchema(extractOutFor(DEMO_PROFILE)));
    expect(schemaText(ExtractOut)).toContain("e.g. 'Member'");
    expect(schemaText(ExtractOut)).not.toMatch(SCHOOL);
  });

  it("names unnamed speakers by the app's own audience in the extract schema", () => {
    expect(schemaText(extractOutFor(closet))).not.toMatch(SCHOOL);
    expect(schemaText(extractOutFor(closet))).toContain("e.g. 'Shopper'");
  });

  it("gives speakers the app's own roles", () => {
    expect(speakerRolesFor(DEMO_PROFILE)).toEqual(["member", "staff", "other"]);
    expect(speakerRolesFor(closet)).toEqual(["shopper", "staff", "other"]);
  });
});

describe("callers use the app's prompts", () => {
  const unit = { quote: "The look viewer makes me scroll to see the whole photo.", speakers: ["Thomas"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null, span_start: 0, span_end: 10 };

  it("classify sends the customer prompt and schema", async () => {
    const llm = vi.fn(async () => ({ items: [] }));
    await classifyUnits(llm as never, [unit], { jobs: [], fewShots: "", product: { profile: closet, audiences: CUSTOMER_AUDIENCES } });
    const call = (llm.mock.calls[0] as unknown[])[0] as { system: string; schema: { toJSONSchema(): unknown } };
    expect(call.system).not.toMatch(SCHOOL);
    expect(schemaText(call.schema)).toBe(schemaText(classifyOutFor(CUSTOMER_AUDIENCES)));
  });

  it("extract, speakers, followups and solve send the customer prompt", async () => {
    const seen: string[] = [];
    const llm = vi.fn(async (a: { system: string; schema: { toJSONSchema(): unknown } }) => { seen.push(a.system, schemaText(a.schema)); return { speakers: [] } as never; });
    await extractUnits(vi.fn(async (a) => { seen.push(a.system, schemaText(a.schema)); return { units: [] }; }) as never, { rawText: "Thomas: it scrolls", author: null, channel: null }, closet);
    await nameSpeakers(llm as never, [{ speaker: 0, start: 0, end: 1, text: "Hi" }], "", closet);
    await draftFollowups(vi.fn(async (a) => { seen.push(a.system); return { questions: [] }; }) as never, { title: "t", problem: "p", quotes: [] }, closet);
    await proposeSolutions(vi.fn(async (a) => { seen.push(a.system); return { options: [] }; }) as never, { title: "t", problem_statement: "p", type: "streamline" }, 1, [], null, null, closet);
    expect(seen.length).toBe(6); // extract (prompt, schema), speakers (prompt, schema), followups, solve
    for (const s of seen) expect(s).not.toMatch(SCHOOL);
    expect(seen[2]).toContain(closet.one_liner);
    expect(seen[3]).toContain("shopper");
  });

  it("the first step writes each type's finding about the app's product", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    try {
      const { writeFinding } = await import("@/lib/diagnosis/run");
      const row = (type: string, projects: { kind: string; product_profile: unknown; name: string }) => ({
        id: "i", type, title: "Look viewer needs scrolling", problem_statement: "p", owner_id: null, diagnosis: null, score_breakdown: null, issue_screens: [], feedback_units: [], projects,
      });
      const finding = { headline: "h", who_wants_it: "w", how_they_cope: "c", there_today: "t", it_touches: "x", steps_today: "s", where_people_stall: "w", evidence: ["e"], where: "w", cause: "c", logging_added: ["l"], confidence: "likely" };
      for (const type of ["bug", "new_feature", "add_on", "streamline"]) {
        const llm = vi.fn(async () => finding);
        await writeFinding(llm as never, row(type, { kind: "customer", product_profile: closet, name: "Closet" }));
        const system = ((llm.mock.calls[0] as unknown[])[0] as { system: string }).system;
        expect(system, type).toContain(closet.one_liner);
        expect(system, type).not.toMatch(SCHOOL);
        const demo = vi.fn(async () => finding);
        await writeFinding(demo as never, row(type, { kind: "demo", product_profile: null, name: "Celeste" }));
        expect(((demo.mock.calls[0] as unknown[])[0] as { system: string }).system, type).toContain(DEMO_PROFILE.one_liner);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the pipeline threads the app's profile into every model call", async () => {
    const systems: string[] = [];
    const answers: unknown[] = [
      { units: [{ ...unit, span_start: undefined, span_end: undefined }] },
      { items: [{ index: 0, type: "streamline", sentiment: -1, emotion: "frustrated", audience: "users", job_code: null, signals: { blocks_task: false, has_workaround: false, data_loss: false, frequency_words: false } }] },
      { screens: [] },
      { decision: "create", issue_id: null, title: "Look viewer needs scrolling", problem_statement: "The full look is cut off." },
      { severity: 3, clarity: 4, scope: "single_screen", reach: 0.8, rationale: { severity: "", clarity: "", scope: "" }, suspected_cause: "" },
    ];
    const llm = vi.fn(async (a: { system: string; schema: { toJSONSchema(): unknown } }) => { systems.push(a.system, schemaText(a.schema)); return answers.shift(); });
    const issue = { id: "i0", title: "", problem_statement: "", type: "streamline" as const, lane: null, importance: null, breakdown: null, units: [] as never[], screens: [] };
    const repo = {
      claimSource: async () => true,
      getSource: async () => ({ id: "s", project_id: "p", raw_text: `Thomas: ${unit.quote}`, author: "Thomas", channel: null, route: null, occurred_at: new Date().toISOString(), kind: "paste", file_path: null, metadata: {} }),
      getProjectContext: async () => ({ jobs: [], routeMap: {}, weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, fewShots: "", product: productOf({ kind: "customer", product_profile: closet, name: "Closet" }) }),
      resetSourceUnits: async () => [],
      insertUnits: async () => [{ id: "u0" }],
      getScreenByFrame: async () => null,
      listScreens: async () => [{ id: "sc", frame_id: "studio/look", scene: "studio", title: "Look", description: null, copy_text: null, similarity: null }],
      listOpenIssues: async () => [],
      createIssue: async () => "i0",
      attachUnit: async () => {},
      logActivity: async () => {},
      getIssueForScoring: async () => ({ ...issue, units: [{ quote: unit.quote, speakers: ["Thomas"], corroborators: [], reported_count: 0, sentiment: -1, emotion: "frustrated", severity_signals: null, occurred_at: new Date().toISOString() }] }),
      saveScores: async () => {},
      setSourceStatus: vi.fn(async () => {}),
    } as unknown as PipelineRepo;
    await processSource({ repo, llm: llm as never, embed: null, onLaneEntered: async () => {} }, "s");
    expect(repo.setSourceStatus).toHaveBeenLastCalledWith("s", "done");
    expect(llm).toHaveBeenCalledTimes(5);
    for (const s of systems) expect(s).not.toMatch(SCHOOL);
    expect(systems[3]).toContain('"users"');
  });
});

describe("audience words on screen", () => {
  it("uses the app's audience for users, the demo's members included", () => {
    expect(audienceWords(DEMO_PROFILE).one).toEqual(AUDIENCE_ONE);
    expect(audienceWords(DEMO_PROFILE).group).toEqual(AUDIENCE_GROUP);
    const w = audienceWords(closet);
    expect([w.one.users, w.group.users, w.many.users]).toEqual(["shopper", "Shoppers", "shoppers"]);
    expect(Object.values(w.one).join(" ")).not.toMatch(SCHOOL);
    expect(Object.values(w.group).join(" ")).not.toMatch(SCHOOL);
    expect([audienceCount("users", 1, w), audienceCount("users", 3, w), audienceCount("users", 2)]).toEqual(["1 shopper", "3 shoppers", "2 members"]);
  });

  it("Why it matters speaks of shoppers for a customer app", () => {
    const input: AnalysisInput = {
      type: "streamline", ease: 70, peopleCount: 1, screens: [], finding: null, recommended: null, profile: closet,
      breakdown: { severity: 3, clarity: 4, scope: "single_screen", reach: 0.8 },
      units: [{ sentiment: -1, emotion: "frustrated", audience: "users", speakers: ["Thomas"], at: "2026-10-16T12:00:00Z" }],
    };
    const a = analyseIssue(input, Date.parse("2026-10-16T13:00:00Z"))!;
    expect(a.stakeholders.word).toMatch(/^Shoppers on /);
    expect(a.verdict).toContain("shoppers");
    expect(JSON.stringify(a)).not.toMatch(SCHOOL);
  });

  it("the issue header names the app's audience", () => {
    expect(audienceNoun(["users"], DEMO_PROFILE)).toBe("member");
    expect(audienceNoun(["users"], closet)).toBe("shopper");
    expect(audienceNoun([], closet)).toBe("shopper");
    expect(audienceNoun(["staff"], closet)).toBe("staff member");
  });
});
