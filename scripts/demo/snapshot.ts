// A pre-computed pipeline result for the Celeste demo sources, so the UI can be explored before any
// Anthropic / Voyage key exists. Rubric values are hand-labelled (the same judgments the rate stage makes);
// importance, ease, people count and lane come from the app's real scoring code.
import { alignSpan } from "../../src/lib/text";
import { aggregateSignals, computeEase, explainImportance, peopleParts, routeLane, type ScoreInputs } from "../../src/lib/scoring";
import type { IssueType, Lane, Scope } from "../../src/lib/types";
import { parseAlertRules, type AlertRules } from "../../src/lib/alerts/rules";
import { checkSteps, fallbackFinding } from "../../src/lib/diagnosis/checks";
import type { Diagnosis, DiagnosisFinding } from "../../src/lib/diagnosis/model";
import { SCREENS } from "./celeste";

/**
 * One issue of each type still waits on its first step, so someone exploring can press Run diagnostics, Scope it,
 * Find where it fits and Map the steps for themselves. Every other issue starts with that step done.
 */
export const WAITING_ON_FIRST_STEP = ["restore-purchase", "full-moon-reminders", "journal-moon-filter", "compare-steps"] as const;

/** Hand-written findings for the issues a demo is likeliest to open; the rest are built by fallbackFinding. */
const FINDINGS: Record<string, Omit<DiagnosisFinding, "where" | "confidence">> = {
  "birth-time-reset": {
    headline: "Saving birth details sends an empty time when only the place changed, and the server fills an empty time with 12:00.",
    cause: "Saving birth details sends an empty time when only the place changed, and the server fills an empty time with 12:00.",
    facts: [], evidence: ["9 members had their birth time set to 12:00 this week, right after changing their birth place.", "None of them had edited the time field."],
    logging_added: ["A log line for each birth details save, with which fields changed and the time before and after."],
  },
  "weekly-forecast": {
    headline: "One This week card on Today with the week's key transits, and its best and hardest days.",
    facts: [{ label: "Who wants it", text: "Members who plan ahead and open Today every morning to piece the week together." }, { label: "How they cope today", text: "They read Today daily and keep track of the days themselves." }],
    evidence: ["\"Checking every day is a lot, and I'd like to plan ahead on Sundays.\""], logging_added: [],
  },
  "compat-save": {
    headline: "It fits on the Compatibility screen, as a Save button that keeps the reading on that friend's row in Friends.",
    facts: [{ label: "There today", text: "The reading is worked out each time and is gone once the member leaves the screen." }, { label: "It touches", text: "The Compatibility screen, and the friend's row in Friends where saved readings would sit." }],
    evidence: ["A member redoes the same reading every time they want to look at it again."], logging_added: [],
  },
  "unknown-birth-time": {
    headline: "Put I don't know my birth time next to the time field, so members choose it before they guess.",
    facts: [{ label: "Steps today", text: "Date, then a guessed time, AM or PM, the place, and only then the small link under Continue." }, { label: "Where people stall", text: "At the time field, where nothing says the time can be left out." }],
    evidence: ["A member guessed 12:00, picked PM by mistake and only then found the link."], logging_added: [],
  },
};

const screenTitle = (frame: string | undefined) => (frame ? SCREENS.find((s) => s.frame_id === frame)?.title ?? frame : null);

/** The seeded first-step state: none for the issues left for a visitor to run, otherwise a finished run from three days ago. */
function seededDiagnosis(spec: IssueSpec, now: string): Diagnosis | null {
  if ((WAITING_ON_FIRST_STEP as readonly string[]).includes(spec.key)) return null;
  const where = screenTitle(spec.screens.at(-1)?.frame_id) ?? "the affected screen";
  const reporter = spec.units[0]?.speakers[0] ?? null;
  const hand = FINDINGS[spec.key];
  const finding: DiagnosisFinding = hand
    ? { ...hand, where, confidence: "likely" }
    : fallbackFinding(spec.type, { title: spec.title, problem: spec.problem, suspected_cause: spec.rubric.suspected_cause, screen: where, reporter });
  const started = Date.parse(now) - 3 * 86_400_000;
  return {
    status: "done", started_at: new Date(started).toISOString(), finished_at: new Date(started + 12_000).toISOString(), by: null,
    steps: checkSteps(spec.type, where, reporter), finding, simulated: true,
  };
}

/** The community-call sample lifts the birth time bug by about 8 (83 to 91), so the demo's jump alert fires at 8 points. */
export const DEMO_JUMP_POINTS = 8;

/**
 * Alert rules after a re-seed: choices already made in Settings (recipients, blocking bugs, digest) are kept, and the
 * jump alert is reset so the coffee-morning sample triggers it. A project with no rules yet alerts every member.
 */
export function demoAlertRules(existing: unknown, memberIds: string[]): AlertRules {
  const chosen = !!existing && typeof existing === "object" && Object.keys(existing).length > 0;
  const rules = parseAlertRules(existing);
  return { ...rules, recipients: chosen ? rules.recipients : memberIds, jump: { enabled: true, points: DEMO_JUMP_POINTS } };
}

export type DemoSource = { id: string; kind: string; author: string; channel: string; occurred_at: string; raw_text: string; route?: string };

const DAY = 86_400_000;
/** The day the demo sources were written: their dates are read as how long before this day each one happened. */
export const DEMO_WRITTEN_AT = "2026-10-16T12:00:00Z";
/** The oldest demo feedback lands this many days before the seed, inside urgency's two full-strength weeks. */
export const DEMO_SPAN_DAYS = 12;

/**
 * The demo sources dated relative to now, so a fresh seed reads as current feedback whenever it runs: each keeps its
 * place in the story (oldest first, the widget reports days later, the support call last), with the whole run
 * squeezed into the last DEMO_SPAN_DAYS. Urgency counts people from the last 30 days and fades a report after two
 * quiet weeks, so the September calls would otherwise leave the demo's birth time bug at 4 and the Urgent rail empty.
 */
export function datedFromToday<T extends { occurred_at: string }>(sources: T[], now: number = Date.now()): T[] {
  const written = Date.parse(DEMO_WRITTEN_AT);
  const ages = sources.map((s) => { const t = Date.parse(s.occurred_at); return Number.isFinite(t) ? Math.max(0, written - t) : 0; });
  const scale = Math.min(1, (DEMO_SPAN_DAYS * DAY) / Math.max(1, ...ages));
  return sources.map((s, k) => ({ ...s, occurred_at: new Date(now - ages[k] * scale).toISOString() }));
}

type UnitSpec = {
  source: string; quote: string; speakers: string[]; corroborators?: string[]; reported_count?: number;
  sentiment: number; emotion: "frustrated" | "confused" | "neutral" | "pleased" | "delighted";
  signals?: Partial<Record<"blocks_task" | "has_workaround" | "data_loss" | "frequency_words", boolean>>;
};
type SolutionSpec = { title: string; summary: string; tradeoffs: string; effort: "S" | "M" | "L"; risk: "low" | "medium" | "high"; recommended?: boolean; mode: "variant" | "round"; target_frames: string[] };
type IssueSpec = {
  key: string; title: string; problem: string; type: IssueType; job: string | null;
  rubric: { severity: number; clarity: number; scope: Scope; reach: number; rationale: { severity: string; clarity: string; scope: string }; suspected_cause?: string };
  screens: { frame_id: string; confidence: number; evidence: string }[];
  units: UnitSpec[]; solutions: SolutionSpec[];
};

/** Extra sources: in-app widget submissions (so one issue has several recent reports), and a support call about a bug to diagnose. */
export const EXTRA_SOURCES: DemoSource[] = [
  { id: "widget-1", kind: "widget", author: "member-2291", channel: "In-app widget", occurred_at: "2026-10-12T07:41:00Z", route: "/", raw_text: "The app takes forever to open in the morning, I just see the stars animation for a while." },
  { id: "widget-2", kind: "widget", author: "member-0874", channel: "In-app widget", occurred_at: "2026-10-13T16:05:00Z", route: "/", raw_text: "Today keeps showing a loading spinner for ages since the last update." },
  // Feature requests, so the New features rail has real items to triage.
  { id: "widget-3", kind: "widget", author: "member-1187", channel: "In-app widget", occurred_at: "2026-10-13T08:12:00Z", route: "/journal", raw_text: "Could you remind me on the evening of each full moon? I always mean to do a full moon journal entry and then forget until the next morning." },
  // The bug the demo diagnoses first: no error, no repro, and a store or server cause can't be ruled out.
  { id: "support-noah-kim", kind: "paste", author: "Noah Kim", channel: "Support call", occurred_at: "2026-10-15T14:20:00Z", raw_text: "Support call with Noah Kim, a Celeste Plus member.\nStaff: Thanks for calling Celeste support, what's going on?\nNoah: I got a new phone last week and Celeste Plus is gone. I tap Restore purchase, it spins for a second and then nothing happens. No message at all.\nStaff: Have you tried signing out and back in?\nNoah: Yes, twice. My monthly forecast is still locked, and I pay for this every year. It's completely blocking me.\nStaff: I'm sorry. Did it show any error?\nNoah: No, nothing. It just goes back to the upgrade screen like I never pressed it. It worked on my old phone.\nStaff: Thanks Noah, I'll pass this to the team today." },
  { id: "widget-4", kind: "widget", author: "member-3302", channel: "In-app widget", occurred_at: "2026-10-14T19:40:00Z", route: "/", raw_text: "Can I get one forecast for the whole week? Checking every day is a lot, and I'd like to plan ahead on Sundays." },
];

export const ISSUES: IssueSpec[] = [
  {
    key: "restore-purchase", title: "Restore purchase does nothing", type: "bug", job: "P01",
    problem: "Members who move to a new phone can't get Celeste Plus back: Restore purchase spins and returns to the upgrade screen with no message, so the features they pay for stay locked.",
    rubric: {
      severity: 5, clarity: 4, scope: "single_screen", reach: 0.7,
      rationale: { severity: "Paying members lose the features they pay for, with no way back.", clarity: "The failure and the expected result are clear, but there are no error details or steps that reproduce it.", scope: "Likely the restore request and the upgrade screen's result state." },
      suspected_cause: "The restore request seems to fail or find no purchase, and the screen shows nothing instead of an error. Whether the app store, the server or the app is at fault is unknown.",
    },
    screens: [{ frame_id: "plus/upgrade", confidence: 0.9, evidence: "\"I tap Restore purchase, it spins\"" }],
    units: [
      { source: "support-noah-kim", quote: "I tap Restore purchase, it spins for a second and then nothing happens. No message at all.", speakers: ["Noah Kim"], sentiment: -2, emotion: "frustrated", signals: { blocks_task: true } },
      { source: "support-noah-kim", quote: "No, nothing. It just goes back to the upgrade screen like I never pressed it. It worked on my old phone.", speakers: ["Noah Kim"], sentiment: -1, emotion: "frustrated" },
    ],
    // Shown after the diagnosis only when there's no model key to write fresh ones from it.
    solutions: [
      { title: "Say what Restore found, with Retry", summary: "After Restore purchase, stay on the screen and say whether Plus came back, no purchase was found, or the store couldn't be reached, with Retry and a Contact support link.", tradeoffs: "Explains the failure but doesn't fix why the restore fails; diagnostics still need to find the cause.", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["plus/upgrade"] },
    ],
  },
  {
    key: "birth-time-reset", title: "Editing birth place resets the birth time", type: "bug", job: "C03",
    problem: "Saving a new birth place puts the birth time back to 12:00 noon, which silently changes the member's rising sign and every reading built on it.",
    rubric: { severity: 5, clarity: 5, scope: "single_screen", reach: 0.9, rationale: { severity: "Birth data is lost without warning, and every reading after it is wrong.", clarity: "Exact steps, the field that changed and the result are all given.", scope: "Saving the birth details form." } },
    screens: [{ frame_id: "chart/natal", confidence: 0.72, evidence: "\"My rising sign changed from Virgo to Capricorn\"" }, { frame_id: "onboarding/birth-details", confidence: 0.93, evidence: "\"I changed my birth place from Porto to Lisbon\"" }],
    units: [
      { source: "call", quote: "when I saved it my birth time went back to twelve noon. My rising sign changed from Virgo to Capricorn and I never touched the time.", speakers: ["Maya Patel"], sentiment: -2, emotion: "frustrated", signals: { data_loss: true } },
      { source: "call", quote: "I had to put the time back in by hand.", speakers: ["Maya Patel"], sentiment: -1, emotion: "frustrated", signals: { has_workaround: true } },
    ],
    solutions: [{ title: "Keep every field when saving", summary: "Save only the field that changed, then show the saved date, time and place with the rising sign before Continue returns to the chart.", tradeoffs: "Adds a short confirmation step to every edit.", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["onboarding/birth-details"] }],
  },
  {
    key: "push-wrong-time", title: "Daily horoscope arrives at the wrong time", type: "bug", job: "T02",
    problem: "After travelling, the daily horoscope keeps arriving at the old time zone's hour, 3 am instead of 8 am, while Notifications still shows 8:00 am.",
    rubric: { severity: 4, clarity: 5, scope: "new_flow_backend", reach: 0.8, rationale: { severity: "It wakes the member every night; turning it off is the only way out.", clarity: "The setting, the trip and the wrong time are all named.", scope: "Notification scheduling, not a screen change." }, suspected_cause: "The send time seems saved in the time zone the member signed up in, so it doesn't follow the phone after a trip." },
    screens: [{ frame_id: "settings/notifications", confidence: 0.88, evidence: "\"I opened Notifications and it still says Send at 8:00 am\"" }],
    units: [
      { source: "call", quote: "Since I got back from a trip to Tokyo it arrives at three in the morning, even though I set it for eight.", speakers: ["Maya Patel"], sentiment: -2, emotion: "frustrated" },
      { source: "call", quote: "I turned Daily horoscope off and on again, and it still comes at three. It wakes me up every night now.", speakers: ["Maya Patel"], sentiment: -2, emotion: "frustrated", signals: { frequency_words: true } },
    ],
    solutions: [
      { title: "Follow the phone's time zone", summary: "Re-schedule the daily horoscope whenever the phone's time zone changes, and show the time zone under Send at.", tradeoffs: "Members who want their home time while travelling lose it unless there's a setting for it.", effort: "M", risk: "low", recommended: true, mode: "round", target_frames: ["settings/notifications"] },
      { title: "Ask after a time zone change", summary: "When the phone's time zone changes, ask once whether the daily horoscope should follow it or keep home time.", tradeoffs: "Respects travellers who want home time; one more prompt after every trip.", effort: "M", risk: "low", mode: "round", target_frames: ["settings/notifications"] },
      { title: "Show the time zone under Send at", summary: "Name the time zone Send at uses, with a one-tap switch to the phone's.", tradeoffs: "Smallest change; members still have to notice and fix it themselves.", effort: "S", risk: "low", mode: "round", target_frames: ["settings/notifications"] },
    ],
  },
  {
    key: "app-slow", title: "App slow to open", type: "bug", job: "X01",
    problem: "Opening the app has become several seconds slower since a recent update, sometimes stuck on the stars animation or a spinner on Today.",
    rubric: { severity: 2, clarity: 2, scope: "new_flow_backend", reach: 0.6, rationale: { severity: "Annoying, not blocking.", clarity: "No device or timing details yet.", scope: "Startup performance, not a design change." }, suspected_cause: "Something added in the last update probably runs before Today can show. Which step, and on which phones, is unknown." },
    screens: [{ frame_id: "today/index", confidence: 0.62, evidence: "widget route /" }],
    units: [
      { source: "call", quote: "The app has been feeling a bit slow to open lately, it takes a few seconds longer than it used to.", speakers: ["Maya Patel"], sentiment: -1, emotion: "neutral" },
      { source: "widget-1", quote: "The app takes forever to open in the morning, I just see the stars animation for a while.", speakers: ["member-2291"], sentiment: -1, emotion: "frustrated" },
      { source: "widget-2", quote: "Today keeps showing a loading spinner for ages since the last update.", speakers: ["member-0874"], sentiment: -1, emotion: "frustrated", signals: { frequency_words: true } },
    ],
    solutions: [],
  },
  {
    key: "share-image-cropped", title: "Shared chart image is cut off", type: "bug", job: "F02",
    problem: "The chart image made for sharing to Instagram crops the bottom, so the Moon sign is missing from the picture.",
    rubric: { severity: 2, clarity: 5, scope: "single_screen", reach: 0.5, rationale: { severity: "An embarrassing share, but nothing is lost.", clarity: "Where it was shared and what is missing are named.", scope: "The share image's layout." }, suspected_cause: "The share image is probably drawn at a fixed height that is too short for the big three, so the last line falls off." },
    screens: [{ frame_id: "chart/natal", confidence: 0.8, evidence: "\"when I share my chart to Instagram\"" }],
    units: [{ source: "slack", quote: "when I share my chart to Instagram the image cuts off the bottom, so my Moon sign isn't in the picture.", speakers: ["Leo Martins"], sentiment: -1, emotion: "neutral" }],
    solutions: [],
  },
  {
    key: "compat-save", title: "Can't save a compatibility reading", type: "add_on", job: "F01",
    problem: "A compatibility reading is gone as soon as the member leaves the screen, so they redo it every time they want to look again.",
    rubric: { severity: 3, clarity: 5, scope: "single_screen", reach: 0.7, rationale: { severity: "Redoing the reading slows them down every time.", clarity: "The wanted Save and today's behaviour are both clear.", scope: "A Save action on one screen, shown on the friend's row." } },
    screens: [{ frame_id: "compatibility/match", confidence: 0.9, evidence: "\"save a compatibility reading so I can come back to it\"" }],
    units: [{ source: "email", quote: "I'd love to save a compatibility reading so I can come back to it. Right now it disappears when I leave the screen and I have to redo it every time.", speakers: ["Sam Rivera"], sentiment: -1, emotion: "neutral", signals: { frequency_words: true } }],
    solutions: [{ title: "Save button on the reading", summary: "A Save button at the top of the reading; saved readings sit on that friend's row in Friends.", tradeoffs: "Saved readings can go stale if a birth time is corrected later.", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["compatibility/match"] }],
  },
  {
    key: "journal-moon-filter", title: "No way to find past full moon entries", type: "add_on", job: "T03",
    problem: "The journal lists entries by date only, so members who want to reread what they wrote on past full moons scroll for ages.",
    rubric: { severity: 3, clarity: 4, scope: "single_screen", reach: 0.5, rationale: { severity: "Members scroll for a long time to find entries.", clarity: "The wanted way to find entries is clear; which phases matter is not.", scope: "A filter on the journal's past entries." } },
    screens: [{ frame_id: "journal/entry", confidence: 0.85, evidence: "\"the journal only lists entries by date\"" }],
    units: [{ source: "note", quote: "Two members said they want to look back at what they wrote on past full moons, but the journal only lists entries by date, so they scroll for ages to find them.", speakers: ["Member"], reported_count: 1, sentiment: -1, emotion: "frustrated" }],
    solutions: [
      { title: "Moon phase filter chips", summary: "Chips above Past entries: All, New moon, Full moon, Eclipse.", tradeoffs: "Smallest change; members still scroll within a phase.", effort: "S", risk: "low", recommended: true, mode: "round", target_frames: ["journal/entry"] },
      { title: "Full moon collection", summary: "A Full moons section that groups every full moon entry, newest first.", tradeoffs: "Answers the request exactly, but only for full moons.", effort: "M", risk: "low", mode: "round", target_frames: ["journal/entry"] },
      { title: "Search entries", summary: "A search box that matches words and moon phases in past entries.", tradeoffs: "Most flexible; more to build, and members must know what to type.", effort: "M", risk: "medium", mode: "round", target_frames: ["journal/entry"] },
    ],
  },
  {
    key: "unknown-birth-time", title: "Unknown birth time option is hidden", type: "streamline", job: "C01",
    problem: "Members who don't know their birth time can't see how to say so: the option is a small link under Continue, so they guess a time and often pick the wrong AM or PM.",
    rubric: { severity: 4, clarity: 5, scope: "single_screen", reach: 0.8, rationale: { severity: "A guessed time gives a wrong rising sign from day one.", clarity: "Where the option is and what went wrong are both named.", scope: "Moving one choice on one screen." } },
    screens: [{ frame_id: "onboarding/birth-details", confidence: 0.93, evidence: "\"I couldn't find any way to say so\"" }],
    units: [{ source: "email", quote: "When I set up my chart I don't know my birth time, and I couldn't find any way to say so. I guessed 12:00, picked PM by mistake, and only afterwards spotted the small link under the Continue button.", speakers: ["Sam Rivera"], sentiment: -1, emotion: "confused" }],
    solutions: [{ title: "Ask before the time field", summary: "An I don't know my birth time switch right under Birth time that hides the time field, and a 24-hour picker instead of AM and PM.", tradeoffs: "A 24-hour picker may feel less familiar to some members.", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["onboarding/birth-details"] }],
  },
  {
    key: "compare-steps", title: "Comparing with a friend takes too many taps", type: "streamline", job: "F01",
    problem: "Comparing charts means going to Friends, finding the friend, opening them and choosing a chart, and even the button on Today only opens the Friends list.",
    rubric: { severity: 3, clarity: 4, scope: "multi_screen", reach: 0.8, rationale: { severity: "A member gave up halfway the first time.", clarity: "Every step is listed; the wanted shortcut is implied.", scope: "Today, Friends and Compatibility." } },
    screens: [{ frame_id: "friends/list", confidence: 0.86, evidence: "\"You go to Friends, find them, tap their name\"" }, { frame_id: "compatibility/match", confidence: 0.7, evidence: "\"then pick which chart to compare\"" }],
    units: [{ source: "slack", quote: "comparing with a friend takes way too many taps? You go to Friends, find them, tap their name, then pick which chart to compare.", speakers: ["Leo Martins"], corroborators: ["Ana Souza"], sentiment: -1, emotion: "frustrated" }],
    solutions: [
      { title: "Recent friends on Today", summary: "The Compare button on Today opens a sheet of recent friends, so a reading is two taps away.", tradeoffs: "Fastest for regulars; still a sheet to scan.", effort: "M", risk: "low", recommended: true, mode: "round", target_frames: ["today/index"] },
      { title: "Compare on each friend's row", summary: "Each row in Friends opens the reading straight away with your own chart, skipping the chart choice.", tradeoffs: "Removes a step; members with several charts lose the choice up front.", effort: "S", risk: "low", mode: "round", target_frames: ["friends/list"] },
      { title: "Remember the last chart", summary: "Keep the chart a member compared with last time and skip asking again.", tradeoffs: "Smallest change; saves one step only.", effort: "S", risk: "low", mode: "variant", target_frames: ["compatibility/match"] },
    ],
  },
  {
    key: "chart-terms", title: "Chart terms go unexplained", type: "streamline", job: "C02",
    problem: "The chart shows Rising and the houses with no explanation, so members look them up elsewhere or never understand them.",
    rubric: { severity: 2, clarity: 4, scope: "copy", reach: 0.7, rationale: { severity: "Members leave the app to understand their own chart.", clarity: "The confusing terms are named.", scope: "Short explanations on one screen." } },
    screens: [{ frame_id: "chart/natal", confidence: 0.9, evidence: "\"The chart says Rising in Virgo and nothing explains it\"" }],
    units: [
      { source: "slack", quote: "does anyone actually know what Rising means? The chart says Rising in Virgo and nothing explains it. I had to look it up.", speakers: ["Chris Park"], corroborators: ["Leo Martins"], sentiment: -1, emotion: "confused" },
      { source: "note", quote: "Everyone found the chart wheel beautiful, but nobody could say what the houses mean", speakers: ["Member"], reported_count: 4, sentiment: -1, emotion: "confused" },
    ],
    solutions: [],
  },
  {
    key: "trial-terms-unclear", title: "Trial doesn't say it becomes yearly", type: "streamline", job: "P01",
    problem: "The Celeste Plus screen never says the free trial turns into a $49.99 yearly plan, so members are surprised by the charge on day eight.",
    rubric: { severity: 4, clarity: 5, scope: "copy", reach: 0.6, rationale: { severity: "An unexpected charge costs trust and invites refunds.", clarity: "The missing price and when it is charged are both named.", scope: "The price line on one screen." } },
    screens: [{ frame_id: "plus/upgrade", confidence: 0.9, evidence: "\"nothing on the screen said it would turn into a yearly plan\"" }],
    units: [{ source: "email", quote: "nothing on the screen said it would turn into a yearly plan. I was charged $49.99 on day eight, which I wasn't expecting at all.", speakers: ["Sam Rivera"], sentiment: -2, emotion: "frustrated" }],
    solutions: [{ title: "Show the price after the trial", summary: "Under 7 days free: \"then $49.99 a year, charged on day 8\", and a reminder the day before the trial ends.", tradeoffs: "Some members may not start the trial once the price is plain.", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["plus/upgrade"] }],
  },
  {
    key: "weekly-forecast", title: "Weekly forecast", type: "new_feature", job: "T01",
    problem: "Members read Today every day to plan ahead and want one forecast for the whole week.",
    rubric: { severity: 2, clarity: 4, scope: "new_flow_backend", reach: 0.7, rationale: { severity: "Planning takes longer, but nothing is blocked.", clarity: "The wanted forecast and when it is used are named.", scope: "A new forecast and where it shows." } },
    screens: [{ frame_id: "today/index", confidence: 0.7, evidence: "\"one forecast for the whole week\"" }],
    units: [{ source: "widget-4", quote: "Can I get one forecast for the whole week? Checking every day is a lot, and I'd like to plan ahead on Sundays.", speakers: ["member-3302"], sentiment: 0, emotion: "neutral" }],
    solutions: [
      { title: "This week card on Today", summary: "A card at the top of Today with the week's key transits and its best and hardest days, opening a day-by-day view.", tradeoffs: "Only seen by members who open the app.", effort: "M", risk: "low", recommended: true, mode: "round", target_frames: ["today/index"] },
      { title: "Sunday push with the week ahead", summary: "A notification every Sunday evening with three lines about the week, opening the This week card.", tradeoffs: "Reaches everyone with notifications on; easy to swipe away.", effort: "M", risk: "low", mode: "round", target_frames: ["settings/notifications"] },
      { title: "Week tab", summary: "A Week tab beside Today that lays out all seven days.", tradeoffs: "Most complete, but a new place in the navigation.", effort: "L", risk: "medium", mode: "round", target_frames: ["today/index"] },
    ],
  },
  {
    key: "full-moon-reminders", title: "Full moon journal reminder", type: "new_feature", job: "T03",
    problem: "Members who like to journal on full moons forget to, and want a reminder that evening.",
    rubric: { severity: 2, clarity: 4, scope: "new_flow_backend", reach: 0.5, rationale: { severity: "Missed entries, but nothing is blocked.", clarity: "The reminder and when it should come are named.", scope: "A new notification and its setting." } },
    screens: [{ frame_id: "journal/entry", confidence: 0.75, evidence: "\"do a full moon journal entry\"" }, { frame_id: "settings/notifications", confidence: 0.6, evidence: "\"remind me on the evening of each full moon\"" }],
    units: [
      { source: "widget-3", quote: "Could you remind me on the evening of each full moon? I always mean to do a full moon journal entry and then forget until the next morning.", speakers: ["member-1187"], sentiment: 0, emotion: "neutral" },
      { source: "note", quote: "One member journals every night and asked for a reminder on the evening of each full moon, because she always means to write a full moon entry and forgets.", speakers: ["Member"], sentiment: 0, emotion: "neutral" },
    ],
    solutions: [
      { title: "Moon reminders in Notifications", summary: "A Full moon reminder switch under Moon phase alerts, at a chosen evening time, opening a new journal entry.", tradeoffs: "Smallest change; members have to find the setting.", effort: "M", risk: "low", recommended: true, mode: "round", target_frames: ["settings/notifications"] },
      { title: "Ask after a full moon entry", summary: "After saving a full moon entry, offer to remind them next time.", tradeoffs: "Reaches the members who want it; misses anyone who hasn't written one yet.", effort: "S", risk: "low", mode: "round", target_frames: ["journal/entry"] },
      { title: "Moon rituals", summary: "Reminders for each phase the member picks, with a prompt to write about.", tradeoffs: "Richest, but more to build and more notifications.", effort: "L", risk: "medium", mode: "round", target_frames: ["journal/entry"] },
    ],
  },
];

/** Positive feedback: stored as units and mapped to screens ("What's working"), never issues. */
export const PRAISE: (UnitSpec & { screens: { frame_id: string; confidence: number; evidence: string }[] })[] = [
  { source: "slack", quote: "the daily reading is the best part of my morning. It feels written for me, not generic.", speakers: ["Ana Souza"], sentiment: 2, emotion: "delighted", screens: [{ frame_id: "today/index", confidence: 0.86, evidence: "\"the daily reading is the best part of my morning\"" }] },
  { source: "note", quote: "three members mentioned that the moon phase on Today is the first thing they check every morning", speakers: ["Member"], reported_count: 2, sentiment: 2, emotion: "pleased", screens: [{ frame_id: "today/index", confidence: 0.9, evidence: "\"the moon phase on Today\"" }] },
];

export type BuiltUnit = UnitSpec & { span_start: number; span_end: number; type: string };
export type BuiltIssue = Omit<IssueSpec, "units"> & {
  units: BuiltUnit[]; importance: number; ease: number; lane: Lane; people_count: number; diagnosis: Diagnosis | null;
  breakdown: Record<string, unknown>;
};

function locate(sources: DemoSource[], u: UnitSpec): { span_start: number; span_end: number } {
  const src = sources.find((s) => s.id === u.source);
  if (!src) throw new Error(`unknown source ${u.source}`);
  const span = alignSpan(src.raw_text, u.quote);
  if (!span) throw new Error(`quote not found in ${u.source}: ${u.quote.slice(0, 40)}…`);
  return { span_start: span.start, span_end: span.end };
}

/**
 * Pure: align every quote to its source and score every issue with the production scoring code. `now` is when the
 * newest report counts as heard (the seed treats every issue as reported today).
 */
export function buildSnapshot(sources: DemoSource[], now: string = new Date().toISOString()): { issues: BuiltIssue[]; praise: (BuiltUnit & { screens: { frame_id: string; confidence: number; evidence: string }[] })[] } {
  const issues = ISSUES.map((spec) => {
    const units = spec.units.map((u) => ({ ...u, ...locate(sources, u), type: spec.type }));
    const people = peopleParts(units.map((u) => ({ speakers: u.speakers, corroborators: u.corroborators ?? [], reportedCount: u.reported_count ?? 0 })));
    const peopleCount = people.distinct + 0.5 * people.reported;
    const meanSentiment = units.reduce((a, u) => a + u.sentiment, 0) / units.length;
    const mappingConfidence = spec.screens.length ? Math.max(...spec.screens.map((s) => s.confidence)) : 0;
    const inputs: ScoreInputs = {
      severity: spec.rubric.severity, reach: spec.rubric.reach, peopleCount, meanSentiment, frustrated: units.some((u) => u.emotion === "frustrated"),
      lastReportAt: now, distinctPeople: people.distinct, reportedByOthers: people.reported,
    };
    const { total: importance, points } = explainImportance({ ...inputs, daysSinceLastReport: 0 });
    const signals = aggregateSignals(units.map((u) => ({ severity_signals: u.signals ?? null })));
    const ease = computeEase({ scope: spec.rubric.scope, clarity: spec.rubric.clarity, mappingConfidence });
    const lane = routeLane({ importance, ease, type: spec.type, recentReports7d: units.length });
    return { ...spec, units, importance, ease, lane, people_count: peopleCount, diagnosis: seededDiagnosis(spec, now), breakdown: { ...spec.rubric, peopleCount, mappingConfidence, meanSentiment, inputs, points, signals } };
  });
  const praise = PRAISE.map((p) => ({ ...p, ...locate(sources, p), type: "praise" }));
  return { issues, praise };
}
