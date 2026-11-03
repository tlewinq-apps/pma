import { z } from "zod";
import { DEMO_AUDIENCES, DEMO_PROFILE, type ProductProfile } from "@/lib/product/profile";

/** The extract schema in the app's words: an unnamed speaker is named by the app's one user ("Member", "Shopper"). */
export const extractOutFor = (p: ProductProfile) => z.object({
  units: z.array(z.object({
    quote: z.string().describe("PMA text copied exactly from the source, one point only"),
    speakers: z.array(z.string()).describe(`Named people who said it; use the role (e.g. '${p.audience_one.charAt(0).toUpperCase()}${p.audience_one.slice(1)}') if unnamed`),
    corroborators: z.array(z.string()).describe("People who agreed in the same source ('Yes!', 'same here')"),
    reported_count: z.number().int().min(0).describe("Additional unnamed people reported to share it, e.g. 'three people said' with one speaker = 2"),
    relevant: z.boolean(),
    filtered_reason: z.string().nullable(),
  })),
});
export const ExtractOut = extractOutFor(DEMO_PROFILE);
export type ExtractOutT = z.infer<typeof ExtractOut>;

export const FeedbackTypeEnum = z.enum(["bug", "new_feature", "add_on", "streamline", "praise", "question", "irrelevant"]);
/** The classify schema for the audiences every app shares: users, staff and leadership. */
export const classifyOutFor = <const A extends readonly string[]>(audiences: A) => z.object({
  items: z.array(z.object({
    index: z.number().int(),
    type: FeedbackTypeEnum,
    sentiment: z.number().int().min(-2).max(2),
    emotion: z.enum(["frustrated", "confused", "neutral", "pleased", "delighted"]),
    audience: z.enum([...audiences, "unknown"] as const),
    job_code: z.string().nullable(),
    signals: z.object({ blocks_task: z.boolean(), has_workaround: z.boolean(), data_loss: z.boolean(), frequency_words: z.boolean() }),
  })),
});
export const ClassifyOut = classifyOutFor(DEMO_AUDIENCES);
export type ClassifyOutT = z.infer<typeof ClassifyOut>;
/** One classified unit, whatever the app's audiences. */
export type ClassifiedItem = Omit<ClassifyOutT["items"][number], "audience"> & { audience: string };

export const MapOut = z.object({
  screens: z.array(z.object({ frame_id: z.string(), confidence: z.number().min(0).max(1), evidence: z.string() })),
});
export type MapOutT = z.infer<typeof MapOut>;

export const ClusterOut = z.object({
  decision: z.enum(["attach", "create"]),
  issue_id: z.string().nullable(),
  title: z.string().nullable().describe("≤6 words, problem-first, only when creating"),
  problem_statement: z.string().nullable(),
});
export type ClusterOutT = z.infer<typeof ClusterOut>;

export const ScopeEnum = z.enum(["copy", "single_screen", "multi_screen", "new_flow", "new_flow_backend"]);
export const RateOut = z.object({
  severity: z.number().int().min(1).max(5),
  clarity: z.number().int().min(1).max(5),
  scope: ScopeEnum,
  reach: z.number().min(0).max(1),
  rationale: z.object({ severity: z.string(), clarity: z.string(), scope: z.string() }),
  suspected_cause: z.string(),
});
export type RateOutT = z.infer<typeof RateOut>;

export const SolveOut = z.object({
  options: z.array(z.object({
    title: z.string(), summary: z.string(), tradeoffs: z.string(),
    effort: z.enum(["S", "M", "L"]), risk: z.enum(["low", "medium", "high"]),
    recommended: z.boolean(), mode: z.enum(["variant", "round"]),
    target_frames: z.array(z.string()),
  })).min(1).max(3)
    .refine((o) => o.filter((x) => x.recommended).length === 1, "exactly one option must be recommended"),
});
export type SolveOutT = z.infer<typeof SolveOut>;

/** What the demo's (simulated) diagnostics run found, before proposals are written from it (lib/diagnosis). */
export const DiagnoseOut = z.object({
  cause: z.string(),
  evidence: z.array(z.string()).min(1).max(3),
  logging_added: z.array(z.string()).min(1).max(3),
  where: z.string(),
  confidence: z.enum(["likely", "confirmed"]),
});
export type DiagnoseOutT = z.infer<typeof DiagnoseOut>;

/** A feature request's scope, before proposals are written from it (lib/diagnosis/checks.ts). */
export const ScopeOut = z.object({
  headline: z.string(), who_wants_it: z.string(), how_they_cope: z.string(),
  evidence: z.array(z.string()).min(1).max(3), where: z.string(),
});
/** Where an add-on fits, before proposals are written from it. */
export const FitOut = z.object({
  headline: z.string(), there_today: z.string(), it_touches: z.string(),
  evidence: z.array(z.string()).min(1).max(3), where: z.string(),
});
/** A streamline issue's step map, before proposals are written from it. */
export const StepsOut = z.object({
  headline: z.string(), steps_today: z.string(), where_people_stall: z.string(),
  evidence: z.array(z.string()).min(1).max(3), where: z.string(),
});
/** The first step on a customer app's bug from the feedback alone: no logging, because nothing was run, and no
 *  confidence, because the feedback alone can't confirm a cause (it is always "likely"). */
export const DiagnoseFeedbackOut = DiagnoseOut.omit({ logging_added: true, confidence: true });

// Reading a customer app's code (lib/repo/context.ts): search terms from the feedback, then which matching files to read.
export const ContextTermsOut = z.object({
  terms: z.array(z.string()).describe("3 to 10 words or names to search the code for: on-screen text people quote, screen or component names, likely identifiers"),
});
export const ContextPickOut = z.object({
  paths: z.array(z.string()).describe("Up to 6 file paths, most relevant first, copied exactly from the list"),
});

/** The lines a code-reading finding rests on: a path and line exactly as the excerpts show them. */
const CodeRefs = z.array(z.object({
  path: z.string().describe("A file path exactly as an excerpt header shows it"),
  line: z.number().int().describe("A line number shown in that excerpt"),
  note: z.string().describe("What that line does, in a few plain words"),
})).describe("Up to 6 lines that matter, from the excerpts only");
/** What to read next when the excerpts miss the code: line ranges in files already shown, or new search terms. Both
 *  empty when the excerpts were enough. The limits (4 ranges, 5 terms) are applied in code: the API keeps no maxItems. */
const NeedMore = z.object({
  ranges: z.array(z.object({
    path: z.string().describe("A file path exactly as an excerpt header shows it"),
    from: z.number().int(), to: z.number().int(),
  })).describe("Up to 4 line ranges to read next; empty when the excerpts were enough"),
  terms: z.array(z.string()).describe("Up to 5 new words or names to search the code for; empty when the excerpts were enough"),
});
/** The four first-step outputs when the run read the app's code: the same fields plus code_refs and need_more (and a
 *  bug's without logging). */
export const DiagnoseCodeOut = DiagnoseOut.omit({ logging_added: true }).extend({ code_refs: CodeRefs, need_more: NeedMore });
export const ScopeCodeOut = ScopeOut.extend({ code_refs: CodeRefs, need_more: NeedMore });
export const FitCodeOut = FitOut.extend({ code_refs: CodeRefs, need_more: NeedMore });
export const StepsCodeOut = StepsOut.extend({ code_refs: CodeRefs, need_more: NeedMore });

/** A short title for a proposal a person wrote in one box. */
export const ProposalNameOut = z.object({ title: z.string().min(1).max(80) });

/** An app's product profile (lib/product/profile.ts), written from what its repository says about itself (fromRepo.ts).
 *  Lengths are checked in code (parseProfile): the API keeps no maxLength. */
export const ProfileOut = z.object({
  name: z.string().describe("The product's name as its people know it, e.g. 'Closet'"),
  one_liner: z.string().describe("What it is, starting with 'a' or 'an', under 25 words, e.g. 'an AI fashion app where people save clothes and generate styled outfit photos'"),
  audience: z.string().describe("Who uses it, one plural word or two, e.g. 'shoppers', 'patients', 'drivers'"),
  audience_one: z.string().describe("One of them, singular, e.g. 'shopper'"),
  platform: z.enum(["web", "mobile", "web and mobile"]).describe("Where people use it"),
});
