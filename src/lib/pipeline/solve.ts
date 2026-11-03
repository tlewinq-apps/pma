import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import { isDemoProfile, type ProductProfile } from "@/lib/product/profile";
import { SolveOut, type SolveOutT } from "./schemas";
import type { DiagnosisFinding } from "@/lib/diagnosis/model";

/**
 * Options for an issue. One on a screen of a design canvas (or any of the demo's) is written as design-frame changes; a
 * customer app's issue with no screens gets options for its own code (solveCode), built on the lines the first step named.
 */
export async function proposeSolutions(
  llm: StructuredCaller,
  issue: { title: string; problem_statement: string; type: string },
  count: 1 | 3,
  flow: { frame_id: string; title: string | null }[],
  currentFlowMd: string | null,
  /** What the first step found (a diagnosis, a scope, where it fits, a step map): the options build on it. */
  diagnosis: DiagnosisFinding | null = null,
  /** The app the issue is in (profileOf its project). */
  profile: ProductProfile,
): Promise<SolveOutT["options"]> {
  const flowList = flow.map((f) => `- ${f.frame_id} (${f.title ?? ""})`).join("\n") || "(unmapped)";
  const fromCode = !flow.length && !isDemoProfile(profile);
  const prompts = promptsFor(profile);
  const lines = fromCode ? (diagnosis?.code_refs ?? []).map((r) => `- ${r.path}:${r.line} ${r.note.replace(/\s+/g, " ").trim()}`) : [];
  const out = await llm({
    system: fromCode ? prompts.solveCode : prompts.solve,
    user: [
      `Return exactly ${count} option(s).`,
      `Issue [${issue.type}]: ${issue.title}`,
      issue.problem_statement,
      "",
      "Current flow frames (in order):",
      flowList,
      "",
      "How users do it today:",
      currentFlowMd ?? "(not documented)",
      ...(diagnosis ? [
        "", "What the first step found:", diagnosis.headline,
        ...diagnosis.facts.map((f) => `${f.label}: ${f.text}`), ...diagnosis.evidence.map((e) => `- ${e}`), `Where: ${diagnosis.where}`,
        ...(lines.length ? ["Lines that matter:", ...lines] : []),
      ] : []),
    ].join("\n"),
    schema: SolveOut,
    effort: "high",
  });
  // Drop target frames the model invented; they must exist in the current flow.
  const valid = new Set(flow.map((f) => f.frame_id));
  return out.options.map((o) => ({ ...o, target_frames: o.target_frames.filter((f) => valid.has(f)) }));
}
