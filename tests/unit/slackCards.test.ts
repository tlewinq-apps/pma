import { describe, it, expect } from "vitest";
import { CHANNEL_PURPOSE, approximateMockup, boardMessage, cardButtons, channelGuide, channelName, homeGroups, homeView, howItWorks, howItWorksForApp, issueCard, validPrefix, type BoardItem, type CardView } from "@/lib/slack/cards";
import { activitySteps, catchUpSteps, checkResultMessage, failedMessage, filedText, mockupMessage, proposalsMessage, type ProposalOption } from "@/lib/slack/messages";
import { changesModal, readNote, readProposalText, writeModal } from "@/lib/slack/modals";
import type { Stage } from "@/components/triage/views";

const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const solutionId = "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b";
const draftId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const card = (o: Partial<CardView> = {}): CardView => ({
  issueId, title: "Pickup time resets <after> save", type: "bug", stage: "needs_proposal", lane: "quick_win", people: 3, importance: 86,
  severity: 5, proposals: 0, owner: null, quote: { text: "I set 3:15 & it went back to 3:00", author: "Sam O." }, url: "https://v.app/issues/1",
  prUrl: null, draftId: null, failedSolutionId: null, demo: true, ...o,
});
type El = { text: { text: string }; action_id: string; value?: string; url?: string; style?: string };
const labels = (els: (El | false | null | undefined | string)[]) => els.filter((e): e is El => !!e && typeof e === "object").map((e) => e.text.text);

const primaries = (els: (El | false | null | undefined | string)[]) => els.filter((e): e is El => !!e && typeof e === "object" && e.style === "primary").map((e) => e.text.text);

describe("issue card", () => {
  it("leads with the type's first step while it waits, and nothing else but Open", () => {
    for (const [type, button] of [["bug", "Run diagnostics"], ["new_feature", "Scope it"], ["add_on", "Find where it fits"], ["streamline", "Map the steps"]] as const) {
      const els = cardButtons(card({ type, stage: "needs_diagnosis" })) as El[];
      expect(labels(els)).toEqual([button, "Open in PMA"]);
      expect(primaries(els)).toEqual([button]);
      expect(JSON.stringify(els)).toContain("pma_diagnose");
    }
  });
  it("offers Write your own once proposals are in the thread, and Get proposals when there are none", () => {
    expect(labels(cardButtons(card({ stage: "proposal_ready" })) as El[])).toEqual(["Write a fix", "Open in PMA"]);
    expect(labels(cardButtons(card({ type: "add_on", stage: "proposal_ready" })) as El[])).toEqual(["Write a proposal", "Open in PMA"]);
    const none = cardButtons(card()) as El[];
    expect(labels(none)).toEqual(["Get proposals", "Write a fix", "Open in PMA"]);
    expect(primaries(none)).toEqual(["Get proposals"]);
    expect(JSON.stringify(cardButtons(card({ stage: "proposal_ready" })))).not.toContain("Take it on");
  });
  it("puts Approve and ship (primary) and Request changes on the card with the draft id", () => {
    const els = cardButtons(card({ stage: "review", draftId, prUrl: "https://github.com/o/r/pull/1" })) as El[];
    expect(labels(els)).toEqual(["Approve and ship", "Request changes", "Open in PMA"]);
    expect(primaries(els)).toEqual(["Approve and ship"]);
    expect((els.filter(Boolean) as El[])[0].value).toBe(`${issueId}:${draftId}`);
  });
  it("says Approve the mock-up on a customer app's approximate mock-up, as the web does: Ready to build, nobody told", () => {
    const els = cardButtons(card({ stage: "review", draftId, demo: false, approximate: true })) as El[];
    expect(labels(els)).toEqual(["Approve the mock-up", "Request changes", "Open in PMA"]);
    expect(primaries(els)).toEqual(["Approve the mock-up"]);
    const json = JSON.stringify(els);
    expect(json).toContain("Approve the mock-up?");
    expect(json).toContain("This marks it Ready to build. Nothing ships yet, and nobody who raised it is told until it's marked shipped.");
    expect(json).not.toMatch(/Approve and ship|marks the issue shipped|tells the people who raised it/);
  });
  it("treats a mock-up as approximate for customer apps only, as the web and approval do", () => {
    expect(approximateMockup("customer", { backend: "mock" })).toBe(true);
    expect(approximateMockup(null, { backend: "mock" })).toBe(true);
    expect(approximateMockup("demo", { backend: "mock" })).toBe(false);
    expect(approximateMockup("customer", { backend: "github" })).toBe(false);
    expect(approximateMockup("customer", null)).toBe(false);
  });
  it("offers Retry on a failed draft and only Open while running, drafting or shipped", () => {
    expect(labels(cardButtons(card({ stage: "failed", failedSolutionId: solutionId })) as El[])).toEqual(["Retry the mockup", "Open in PMA"]);
    for (const stage of ["drafting", "diagnosing", "shipped", "dismissed"] as Stage[]) expect(labels(cardButtons(card({ stage })) as El[])).toEqual(["Open in PMA"]);
  });
  it("escapes text, uses the type colour bar, and says type, people, impact and stage in words", () => {
    const c = issueCard(card({ owner: "Thomas" }));
    const json = JSON.stringify(c);
    expect(json).toContain("&lt;after&gt;");
    expect(json).toContain("3:15 &amp; it");
    expect(json).toContain("Bug  ·  3 people  ·  Blocker  ·  No proposal yet");
    expect(json).not.toMatch(/Priority|Quick win|Taken on/);
    expect(JSON.stringify(issueCard(card({ type: "new_feature", stage: "needs_diagnosis", severity: null })))).toContain("New feature  ·  3 people  ·  Needs scoping");
    expect(JSON.stringify(issueCard(card({ stage: "proposal_ready", proposals: 3 })))).toContain("3 proposals in the thread");
    expect(c.attachments).toEqual([expect.objectContaining({ color: "#b8382a" })]);
  });
  it("counts people in a customer app's audience words when it has them, and keeps person and people otherwise", () => {
    expect(JSON.stringify(issueCard(card({ people: 1, demo: false, peopleText: "1 shopper" })))).toContain("Bug  ·  1 shopper  ·  Blocker  ·  No proposal yet");
    expect(JSON.stringify(issueCard(card({ people: 3, demo: false, peopleText: "3 shoppers" })))).toContain("Bug  ·  3 shoppers  ·  Blocker");
    expect(JSON.stringify(issueCard(card({ people: 1 })))).toContain("Bug  ·  1 person  ·  Blocker");
    expect(JSON.stringify(issueCard(card({ people: 1, demo: false, peopleText: "1 shopper" })))).not.toMatch(/1 person/);
  });
});

describe("channel names", () => {
  it("derives one channel per role from a prefix", () => {
    expect(["inbox", "bug", "new_feature", "add_on", "streamline"].map((r) => channelName("pma", r as never)))
      .toEqual(["pma-feedback", "pma-bugs", "pma-features", "pma-add-ons", "pma-streamline"]);
    expect(validPrefix("pma")).toBe(true);
    expect(validPrefix("PMA")).toBe(false);
    expect(validPrefix("my team")).toBe(false);
  });
});

describe("proposals, results and mockup messages", () => {
  const opt = (o: Partial<ProposalOption> = {}): ProposalOption => ({ solutionId, letter: "A", title: "Show the error with Retry", summary: "Replace the blank <screen> with a message and a Retry button.", recommended: true, by: null, status: null, ...o });
  const accessories = (m: { blocks: object[] }) => m.blocks.map((b) => (b as { accessory?: El }).accessory).filter((a): a is El => !!a);
  it("puts every proposal in one message, headed per type, with Mock this up primary on the recommended one", () => {
    const m = proposalsMessage({ issueId, type: "bug", stage: "proposal_ready", options: [opt(), opt({ solutionId: draftId, letter: "B", title: "Load in pages", recommended: false, by: "Thomas" })] });
    const json = JSON.stringify(m);
    expect(json).toContain("*2 ways to fix it*");
    expect(json).toContain("*A. Show the error with Retry*  ·  Recommended");
    expect(json).toContain("*B. Load in pages*  ·  by Thomas");
    expect(json).toContain("blank &lt;screen&gt;");
    expect(accessories(m).map((a) => [a.text.text, a.value, a.style ?? null])).toEqual([["Mock this up", `${issueId}:${solutionId}`, "primary"], ["Mock this up", `${issueId}:${draftId}`, null]]);
    expect(labels((m.blocks.at(-1) as { elements: El[] }).elements)).toEqual(["Write your own"]);
    expect(json).not.toMatch(/effort|risk|Screens|Edit"/i);
    expect(JSON.stringify(proposalsMessage({ issueId, type: "streamline", stage: "proposal_ready", options: [opt()] }))).toContain("*One way to simplify it*");
  });
  it("drops the mock buttons while drafting or shipped, and only offers Mock this instead during review", () => {
    expect(accessories(proposalsMessage({ issueId, type: "bug", stage: "drafting", options: [opt({ status: "Drafting now" })] }))).toEqual([]);
    const shipped = proposalsMessage({ issueId, type: "bug", stage: "shipped", options: [opt({ status: "Mocked up" })] });
    expect(accessories(shipped)).toEqual([]);
    expect(shipped.blocks.some((b) => (b as { type: string }).type === "actions")).toBe(false);
    const review = proposalsMessage({ issueId, type: "bug", stage: "review", options: [opt({ status: "Mocked up" }), opt({ letter: "B", recommended: false })] });
    expect(accessories(review).map((a) => [a.text.text, a.style ?? null])).toEqual([["Mock this instead", null]]);
  });
  it("posts what the first step found as one message: the type's result word, the headline and two lines", () => {
    const r = checkResultMessage("new_feature", { headline: "One option on <Pickup>.", lines: ["Who wants it: parents", "How they cope today: they call", "third"] });
    expect(r.blocks[0]).toEqual({ type: "section", text: { type: "mrkdwn", text: "*Scoped.* One option on &lt;Pickup&gt;." } });
    expect((r.blocks[1] as { elements: unknown[] }).elements).toHaveLength(2);
    expect(JSON.stringify(checkResultMessage("bug", { headline: "It times out.", lines: [] }))).toContain("*Cause found.* It times out.");
  });
  it("keeps https images only, offers Approve and ship, links a real pull request only, and closes with a note", () => {
    const m = { issueId, draftId, solutionTitle: "Keep the typed time", demo: false, github: false, prUrl: "https://v.app/mock/pr/1", url: "https://v.app/issues/1", closed: null,
      images: [{ label: "Pickup: current and proposed", url: "https://s.co/a.png" }, { label: "bad", url: "data:image/svg+xml,x" }] };
    const open = mockupMessage(m);
    expect(open.blocks.filter((b) => (b as { type: string }).type === "image")).toHaveLength(1);
    expect(labels((open.blocks.at(-1) as { elements: El[] }).elements)).toEqual(["Approve and ship", "Request changes"]);
    expect(JSON.stringify(open)).toContain("*Mockup: Keep the typed time*");
    expect(JSON.stringify(open)).not.toMatch(/pull request|Demo render/);
    expect(JSON.stringify(mockupMessage({ ...m, github: true, prUrl: "https://github.com/o/r/pull/1" }))).toContain("Open the pull request");
    const closed = mockupMessage({ ...m, closed: "Approved by Thomas." });
    expect(closed.blocks.some((b) => (b as { type: string }).type === "actions")).toBe(false);
    expect(JSON.stringify(closed)).toContain("Approved by Thomas.");
    expect(JSON.stringify(mockupMessage({ ...m, images: [] }))).toContain("to see the frames.");
  });
  it("offers Approve the mock-up on a customer app's approximate mock-up, and never promises to ship it", () => {
    const m = { issueId, draftId, solutionTitle: "Fit the look", demo: false, github: false, prUrl: "https://v.app/mock/pr/1", url: "https://v.app/issues/1", closed: null,
      images: [{ label: "Studio: current and proposed", url: "https://s.co/a.png" }], approximate: true };
    const buttons = (mockupMessage(m).blocks.at(-1) as { elements: El[] }).elements;
    expect(labels(buttons)).toEqual(["Approve the mock-up", "Request changes"]);
    expect(JSON.stringify(buttons)).toContain("Ready to build");
    expect(JSON.stringify(buttons)).not.toMatch(/Approve and ship|marks the issue shipped|tells the people who raised it/);
  });
  it("tells a customer app's App Home that approving means ready to build, and shipping is what tells people", () => {
    const how = howItWorksForApp({ inbox: "C1", cards: "C2" }, { audience: "shoppers" });
    expect(how).toContain("approve the mock-up: it's then ready to build. Once it's marked shipped, the people who raised it are told in their own thread.");
  });
  it("offers Retry on the failed note only when the proposal is known", () => {
    expect(labels((failedMessage({ issueId, solutionId, logUrl: null, url: "https://v.app" }).blocks[1] as { elements: El[] }).elements)).toEqual(["Retry the mockup"]);
    expect(labels((failedMessage({ issueId, solutionId: null, logUrl: null, url: "https://v.app" }).blocks[1] as { elements: El[] }).elements)).toEqual([]);
  });
});

describe("activity in the thread", () => {
  const steps = (kind: string, payload: Record<string, unknown> = {}) => activitySteps({ kind, payload }, "Thomas");
  it("skips noise and the creating feedback (the card shows it)", () => {
    for (const k of ["viewed", "lane_changed", "slack_sent", "slack_failed", "draft_skipped", "pr_event"]) expect(steps(k)).toEqual([]);
    expect(steps("feedback_added", { created: true, quote: "x" })).toEqual([]);
  });
  it("never echoes a comment typed in Slack", () => {
    expect(steps("commented", { source: "slack", text: "hi" })).toEqual([]);
    expect(steps("commented", { text: "from the web" })).toEqual([{ kind: "text", text: "Thomas: from the web" }]);
  });
  it("turns rows into lines and actions", () => {
    expect(steps("feedback_added", { created: false, quote: "Same <here>", author: "Ana" })).toEqual([{ kind: "text", text: "New feedback from Ana:\n> Same &lt;here&gt;" }]);
    expect(steps("assigned", { to: "me" })).toEqual([{ kind: "text", text: "Taken on by Thomas." }]);
    expect(steps("assigned", { to: "me", auto: true })).toEqual([]);
    for (const k of ["proposals_ready", "proposal_added", "proposal_edited", "proposal_restored", "proposal_removed"]) expect(steps(k, { title: "X" })).toEqual([{ kind: "proposals" }]);
    expect(steps("draft_dispatched", { solution: "Keep it", demo: true })).toEqual([
      { kind: "close_mockup", draftId: null, note: "Replaced by a newer mockup." },
      { kind: "text", text: 'Mocking up "Keep it". Ready in a few seconds.' },
      { kind: "proposals" },
    ]);
    expect(steps("draft_ready")).toEqual([{ kind: "mockup" }, { kind: "proposals" }]);
    expect(steps("draft_failed", { log_url: "https://gh/log" })).toEqual([{ kind: "failed", logUrl: "https://gh/log" }, { kind: "proposals" }]);
    expect(steps("approved", { draft_id: draftId })).toEqual([
      { kind: "close_mockup", draftId, note: "Approved by Thomas." }, { kind: "text", text: "Shipped. Approved by Thomas." }, { kind: "proposals" },
    ]);
    expect(steps("changes_requested", { note: "Bigger button", draft_id: draftId })).toEqual([
      { kind: "close_mockup", draftId, note: "Changes requested by Thomas." },
      { kind: "text", text: "Thomas asked for changes:\n> Bigger button" },
    ]);
    expect(steps("relabeled", { from: "bug", to: "add_on" })).toEqual([{ kind: "text", text: "Re-labelled from Bug to Add-on by Thomas." }]);
  });
  it("catches a new card up on what the first step found, the proposals and the current mockup", () => {
    expect(catchUpSteps("needs_diagnosis", 3, "bug")).toEqual([]);
    expect(catchUpSteps("diagnosing", 0, "add_on")).toEqual([{ kind: "text", text: "Finding where it fits. Proposals arrive when it finishes." }]);
    expect(catchUpSteps("needs_proposal", 0)).toEqual([]);
    expect(catchUpSteps("proposal_ready", 2)).toEqual([{ kind: "proposals" }]);
    const found = { headline: "It times out.", lines: [] };
    expect(catchUpSteps("review", 2, "bug", found)).toEqual([{ kind: "message", msg: checkResultMessage("bug", found) }, { kind: "proposals" }, { kind: "mockup" }]);
    expect(catchUpSteps("failed", 1)).toEqual([{ kind: "proposals" }, { kind: "failed", logUrl: null }]);
  });
});

describe("filed reply", () => {
  const issue = { type: "bug" as const, title: "Pickup resets", link: "https://acme.slack.com/archives/C1/p1", created: true, people: 1 };
  it("links one new issue, lists several, and explains when nothing was filed", () => {
    expect(filedText({ status: "done", issues: [issue] })).toBe("Filed. Bugs: <https://acme.slack.com/archives/C1/p1|Pickup resets> (new)");
    expect(filedText({ status: "done", issues: [issue, { ...issue, type: "add_on", created: false, people: 4, title: "Absence form" }] }))
      .toBe("Filed.\n• Bugs: <https://acme.slack.com/archives/C1/p1|Pickup resets> (new)\n• Add-ons: <https://acme.slack.com/archives/C1/p1|Absence form>, now 4 people");
    expect(filedText({ status: "done", issues: [] })).toContain("Nothing to file");
    expect(filedText({ status: "failed", issues: [] })).toContain("couldn't read");
    expect(filedText({ status: "duplicate", issues: [] })).toBe("This is already in PMA.");
  });
});

describe("board and App Home", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const item = (o: Partial<BoardItem>): BoardItem => ({ title: "T", type: "bug", stage: "drafting", owner: null, ownerId: null, link: null, updatedAt: "2026-10-15T10:00:00Z", importance: null, ...o });
  it("groups by stage, shows owned open work, and drops shipped items after a week", () => {
    const b = JSON.stringify(boardMessage([
      item({ title: "Mine", stage: "proposal_ready", owner: "Thomas", ownerId: "u1" }),
      item({ title: "Unowned", stage: "proposal_ready" }),
      item({ title: "Drafting one" }),
      item({ title: "Old ship", stage: "shipped", updatedAt: "2026-10-01T00:00:00Z" }),
      item({ title: "New ship", stage: "shipped", link: "https://acme.slack.com/archives/C1/p2" }),
    ], now, "https://v.app"));
    expect(b).toContain("*Taken on*  1\\n• Mine  ·  Bug  ·  Thomas");
    expect(b).not.toContain("Unowned");
    expect(b).toContain("*Drafting*  1");
    expect(b).not.toContain("Old ship");
    expect(b).toContain("<https://acme.slack.com/archives/C1/p2|New ship>");
    expect(b).toContain("*In review*\\nNothing right now");
  });
  it("lists the highest priority first within each group, without the number", () => {
    const b = JSON.stringify(boardMessage([
      item({ title: "Low", importance: 30 }), item({ title: "Unscored" }), item({ title: "High", importance: 86 }),
    ], now, "https://v.app"));
    expect(b).toContain("*Drafting*  3\\n• High  ·  Bug\\n• Low  ·  Bug\\n• Unscored  ·  Bug");
  });
  it("leads App Home with the five highest-priority issues waiting on a first step", () => {
    const waiting = [10, 90, 50, 70, 30, 80].map((n) => item({ title: `P${n}`, stage: "needs_diagnosis", importance: n }));
    const g = homeGroups([...waiting, item({ title: "Has proposals", stage: "needs_proposal", importance: 99 }), item({ title: "Drafting", importance: 95 })], "u1");
    expect(g[0]).toEqual({ label: "Waiting on a first step", items: [90, 80, 70, 50, 30].map((n) => expect.objectContaining({ title: `P${n}` })) });
  });
  it("explains PMA on App Home and in a pinned guide per channel", () => {
    const how = howItWorks({ inbox: "C1", bug: "C2" });
    expect(how).toContain("<#C1>");
    expect(how).toContain("<#C2>, #pma-features");
    expect(how).toContain("Run diagnostics, Scope it, Find where it fits, Map the steps");
    expect(JSON.stringify(homeView({ notMember: null, groups: [], appUrl: "https://v.app", now, channels: { inbox: "C1" } }))).toContain("How PMA works");
    expect(JSON.stringify(channelGuide("streamline", "https://v.app"))).toContain("*Map the steps*");
    for (const p of Object.values(CHANNEL_PURPOSE)) expect(p.length).toBeLessThanOrEqual(250);
  });
  it("shows a member their own work and reviews nobody owns", () => {
    const g = homeGroups([
      item({ title: "A", stage: "proposal_ready", ownerId: "u1" }), item({ title: "B", stage: "drafting", ownerId: "u2" }),
      item({ title: "C", stage: "review" }), item({ title: "D", stage: "review", ownerId: "u2" }),
    ], "u1");
    expect(g.map((x) => [x.label, x.items.map((i) => i.title)])).toEqual([["Waiting on a first step", []], ["Taken on by you", ["A"]], ["Drafting", []], ["Waiting for your review", ["C"]]]);
    expect(JSON.stringify(homeView({ notMember: "Not a member", groups: g, appUrl: "https://v.app", now }))).toContain("Not a member");
  });
});

describe("forms", () => {
  const write = (o: Partial<Parameters<typeof writeModal>[0]> = {}) => writeModal({ mode: "write", meta: { issueId }, type: "bug", issueTitle: "Class <messages>", headline: "It times out.", screen: "Message thread", ...o }) as { title: { text: string }; submit: { text: string }; blocks: { type: string; block_id?: string; element?: Record<string, unknown>; label?: { text: string }; hint?: { text: string } }[] };
  it("is one box, labelled for the issue's type, saying what the first step found and which screen gets mocked up", () => {
    const v = write();
    expect(v.title.text).toBe("Write a fix");
    expect(v.submit.text).toBe("Add");
    const inputs = v.blocks.filter((b) => b.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].block_id).toBe("text");
    expect(inputs[0].label!.text).toBe("How would you fix it?");
    expect(inputs[0].hint!.text).toBe("PMA names it and mocks up Message thread.");
    expect(JSON.stringify(v.blocks[0])).toContain("Class &lt;messages&gt;");
    expect(JSON.stringify(v.blocks[0])).toContain("Cause: It times out.");
    const feature = write({ type: "new_feature", headline: null, screen: null });
    expect(feature.title.text).toBe("Write a proposal");
    expect(feature.blocks.find((b) => b.type === "input")!.label!.text).toBe("What would you build?");
  });
  it("prefills an edit and reads the box back as the one-box body", () => {
    const v = write({ mode: "edit", meta: { issueId, solutionId }, initial: "Show a Retry button" });
    expect(v.blocks.find((b) => b.block_id === "text")!.element!.initial_value).toBe("Show a Retry button");
    expect(readProposalText({ text: { v: { value: "Show a Retry button" } } })).toEqual({ text: "Show a Retry button" });
    expect(readProposalText(undefined)).toEqual({ text: "" });
  });
  it("reads the change note", () => {
    expect(readNote({ note: { v: { value: "Bigger" } } })).toEqual({ note: "Bigger" });
    expect(readNote(undefined)).toEqual({ note: "" });
    expect(JSON.stringify(changesModal({ meta: { issueId, draftId }, issueTitle: "Pickup" }))).toContain(draftId);
  });
});

describe("no emoji, and at most one primary button per message", () => {
  it("holds for every builder", () => {
    const opt = { solutionId, letter: "A", title: "t", summary: "s", recommended: true, by: null, status: null };
    const built = [
      issueCard(card()), ...(["needs_diagnosis", "needs_proposal", "proposal_ready", "failed", "drafting", "review", "in_review", "shipped", "dismissed"] as Stage[]).map((stage) => issueCard(card({ stage, draftId, failedSolutionId: solutionId }))),
      proposalsMessage({ issueId, type: "add_on", stage: "proposal_ready", options: [opt, { ...opt, letter: "B", recommended: false }] }),
      checkResultMessage("streamline", { headline: "h", lines: ["a", "b"] }),
      mockupMessage({ issueId, draftId, solutionTitle: "t", demo: false, github: true, images: [], prUrl: "https://gh/pr", url: "https://v.app", closed: null }),
      failedMessage({ issueId, solutionId, logUrl: "https://gh/log", url: "https://v.app" }),
      boardMessage([], Date.now(), "https://v.app"), homeView({ notMember: null, groups: [], appUrl: "https://v.app", now: Date.now() }),
      writeModal({ mode: "write", meta: { issueId }, type: "bug", issueTitle: "t", headline: "h", screen: "s" }), changesModal({ meta: { issueId }, issueTitle: "t" }), channelGuide("inbox", "https://v.app"),
      ...["feedback_added", "assigned", "diagnosis_started", "diagnosis_ready", "diagnosis_failed", "draft_dispatched", "changes_requested", "approved", "dismissed", "decision", "relabeled", "retitled", "lane_action_failed"].map((k) => activitySteps({ kind: k, payload: { to: "me", from: "bug", headline: "h" } }, "T")),
      filedText({ status: "done", issues: [{ type: "bug", title: "t", link: null, created: true, people: 1 }] }),
    ];
    const all = JSON.stringify(built);
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(all.match(/"style":"(\w+)"/g)?.every((x) => x === '"style":"primary"') ?? true).toBe(true);
    for (const b of built) expect((JSON.stringify(b).match(/"style":"primary"/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe("alerts in the card thread", () => {
  it("posts an alert as one line, broadcast to the channel", () => {
    expect(activitySteps({ kind: "alert", payload: { rule: "jump", from: 52, to: 71, sent_to: ["Thomas"] } }, "PMA")).toEqual([
      { kind: "text", text: "Rising fast since yesterday. Sent to Thomas.", broadcast: true },
    ]);
  });
  it("tells the thread who started the first step and posts what it found, in the type's words", () => {
    expect(activitySteps({ kind: "diagnosis_started", payload: { screen: "Messages › Message thread" } }, "Thomas")).toEqual([{ kind: "text", text: "Thomas is running diagnostics." }]);
    expect(activitySteps({ kind: "diagnosis_started", payload: { type: "streamline" } }, "Thomas")).toEqual([{ kind: "text", text: "Thomas is mapping the steps." }]);
    expect(activitySteps({ kind: "diagnosis_started", payload: {} }, "Thomas", "new_feature")).toEqual([{ kind: "text", text: "Thomas is scoping it." }]);
    // Older rows stored only the bug's cause.
    expect(activitySteps({ kind: "diagnosis_ready", payload: { cause: "The request <times> out." } }, "PMA")).toEqual([{ kind: "message", msg: checkResultMessage("bug", { headline: "The request <times> out.", lines: [] }) }]);
    expect(activitySteps({ kind: "diagnosis_ready", payload: { type: "add_on", headline: "On the report.", lines: ["There today: x"] } }, "PMA")).toEqual([{ kind: "message", msg: checkResultMessage("add_on", { headline: "On the report.", lines: ["There today: x"] }) }]);
    expect(activitySteps({ kind: "diagnosis_failed", payload: { type: "add_on", error: "boom" } }, "PMA")).toEqual([{ kind: "text", text: "Find where it fits didn't finish: boom. Press Find where it fits on the card to try again." }]);
  });
  it("keeps priority changes out of the thread (the alert carries the news)", () => {
    expect(activitySteps({ kind: "priority_changed", payload: { from: 40, to: 70 } }, "PMA")).toEqual([]);
  });
});

describe("closing the loop in the card thread", () => {
  it("notes who was told it shipped and who was asked follow-ups", () => {
    expect(activitySteps({ kind: "reporters_told", payload: { names: ["Alex", "Leah"] } }, "PMA")).toEqual([{ kind: "text", text: "Told Alex and Leah in their own threads." }]);
    expect(activitySteps({ kind: "followups_asked", payload: { names: ["Alex"] } }, "Thomas")).toEqual([{ kind: "text", text: "Thomas asked Alex follow-up questions. Their answers come back as new feedback." }]);
    expect(activitySteps({ kind: "followups_drafted", payload: { questions: ["Which screen?"] } }, "PMA")).toEqual([]);
    expect(activitySteps({ kind: "followup_answered", payload: { name: "Alex", quote: "It's the calendar", filed: ["Week view slow to load", "Content jumps"] } }, "PMA")).toEqual([
      { kind: "text", text: "Alex answered the follow-up:\n> It's the calendar\nFiled under Week view slow to load and Content jumps." },
    ]);
  });
});
