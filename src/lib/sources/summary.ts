// What a piece of incoming feedback became, in words: the "Received" list on Add feedback and the source detail page.
import { friendlyLlmError } from "@/lib/llm/errors";

export type SourceState = { status: string; kind: string; rawTextEmpty: boolean; error: string | null };
export type UnitOutcome = { issue_id: string | null; type: string };

export type StatusGroup = "working" | "needs_you" | "done";
export const STATUS_GROUPS: { key: StatusGroup; label: string }[] = [
  { key: "working", label: "Working" }, { key: "needs_you", label: "Needs you" }, { key: "done", label: "Done" },
];

export type SourceKind = "recording" | "document" | "pasted" | "slack" | "widget" | "api" | "other";
export const KIND_LABEL: Record<SourceKind, string> = {
  recording: "Recording", document: "Document", pasted: "Pasted", slack: "Slack", widget: "Widget", api: "API", other: "Other",
};

const SET_ASIDE = new Set(["irrelevant", "question"]);

/** Setup problems read better as what to fix, and Claude's errors as plain sentences (friendlyLlmError). The raw
 *  message stays in sources.error for debugging. */
function friendlyError(error: string | null): string {
  if (!error) return "unknown error";
  if (/Could not resolve authentication method/i.test(error)) return "PMA needs an Anthropic API key (ANTHROPIC_API_KEY) to read feedback";
  return friendlyLlmError(error);
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function statusGroup(status: string): StatusGroup {
  if (status === "failed") return "needs_you";
  return status === "done" ? "done" : "working";
}

export function sourceKind(s: { kind: string; channel: string | null }): SourceKind {
  switch (s.kind) {
    case "audio": return "recording";
    case "file": return "document";
    case "slack": return "slack";
    case "widget": return "widget";
    case "paste": return s.channel === "API" ? "api" : "pasted";
    default: return "other";
  }
}

/** One line: where it is in the pipeline, or what it was filed as once done. */
export function summarizeSource(s: SourceState, units: UnitOutcome[], titles: Map<string, string>, created: Set<string>): string {
  if (s.status === "queued") return "Waiting to be read";
  if (s.status === "processing") return s.kind === "audio" && s.rawTextEmpty ? "Transcribing" : "Reading";
  if (s.status === "failed") return `Couldn't read: ${friendlyError(s.error)}`;

  const filed = units.filter((u) => u.issue_id);
  const issues = [...new Set(filed.map((u) => u.issue_id!))];
  const praise = units.filter((u) => u.type === "praise").length;
  const setAside = units.filter((u) => SET_ASIDE.has(u.type)).length;
  const extras = [praise ? plural(praise, "piece of praise", "pieces of praise") : null, setAside ? `${setAside} set aside` : null].filter(Boolean);

  let head: string;
  if (issues.length === 1) {
    const verb = created.has(issues[0]) ? "Started" : "Joined";
    head = `${verb} ${titles.get(issues[0]) ?? "an issue"}`;
    if (filed.length > 1) extras.unshift(plural(filed.length, "piece of feedback", "pieces of feedback"));
  } else if (issues.length > 1) {
    head = `${plural(filed.length, "piece of feedback", "pieces of feedback")}, filed under ${plural(issues.length, "issue", "issues")}`;
  } else {
    head = "Nothing to act on";
  }
  return [head, ...extras].join(", ");
}

/** Unknown filter values are ignored, so a stale link never empties the list. */
export function filterSources<T extends { kind: string; channel: string | null; status: string }>(rows: T[], f: { status?: string; kind?: string }): T[] {
  const status = STATUS_GROUPS.some((g) => g.key === f.status) ? f.status : undefined;
  const kind = f.kind && f.kind in KIND_LABEL ? f.kind : undefined;
  return rows.filter((r) => (!status || statusGroup(r.status) === status) && (!kind || sourceKind(r) === kind));
}

/** "2 minutes", "1 hour 2 minutes": rounded to the nearest minute, no clock notation. */
export function durationLabel(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  if (sec < 60) return "Under a minute";
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [h ? part(h, "hour") : null, m ? part(m, "minute") : null].filter(Boolean).join(" ");
}
