import { describe, it, expect } from "vitest";
import { DEMO_PROFILE, profileOf } from "@/lib/product/profile";
import { fallbackTitle, isTextProposal, parseProposalText, parseProposalInput, modeFor, modeAfterEdit, defaultScreens, snapshotOriginal, regeneratePlan, editLocked, changedSinceDraft, provenanceLabel, audienceNoun, peopleWords, peopleLabelFor, peopleTextFor } from "@/lib/proposals";

const frames = ["pickup/notify", "home/index"];
const ok = { title: "  Sent states  ", summary: " Show a confirmation. ", tradeoffs: "", effort: "S", risk: null, target_frames: ["pickup/notify"] };

describe("parseProposalInput", () => {
  it("trims, treats an empty catch as none, and keeps the chosen screens", () => {
    expect(parseProposalInput(ok, frames)).toEqual({ value: { title: "Sent states", summary: "Show a confirmation.", tradeoffs: null, effort: "S", risk: null, target_frames: ["pickup/notify"] } });
  });
  it("accepts Not sure (null) for effort and risk, and no screens", () => {
    expect(parseProposalInput({ ...ok, effort: null, risk: undefined, target_frames: [] }, frames)).toEqual({ value: { title: "Sent states", summary: "Show a confirmation.", tradeoffs: null, effort: null, risk: null, target_frames: [] } });
  });
  it("de-duplicates screens in order", () => {
    expect(parseProposalInput({ ...ok, target_frames: ["home/index", "pickup/notify", "home/index"] }, frames)).toMatchObject({ value: { target_frames: ["home/index", "pickup/notify"] } });
  });
  it("explains what is missing or too long", () => {
    expect(parseProposalInput({ ...ok, title: "  " }, frames)).toEqual({ error: "Give the proposal a name" });
    expect(parseProposalInput({ ...ok, title: "x".repeat(81) }, frames)).toEqual({ error: "Keep the name under 80 characters" });
    expect(parseProposalInput({ ...ok, summary: "" }, frames)).toEqual({ error: "Describe what changes" });
    expect(parseProposalInput({ ...ok, summary: "x".repeat(1001) }, frames)).toEqual({ error: "Keep the description under 1000 characters" });
    expect(parseProposalInput({ ...ok, tradeoffs: "x".repeat(501) }, frames)).toEqual({ error: "Keep the catch under 500 characters" });
    expect(parseProposalInput(null, frames)).toEqual({ error: "Give the proposal a name" });
  });
  it("rejects values outside the choices", () => {
    expect(parseProposalInput({ ...ok, effort: "XL" }, frames)).toEqual({ error: "Pick a size: Small, Medium, Large or Not sure" });
    expect(parseProposalInput({ ...ok, risk: "extreme" }, frames)).toEqual({ error: "Pick a risk: Low, Medium, High or Not sure" });
    expect(parseProposalInput({ ...ok, target_frames: ["admin/secret"] }, frames)).toEqual({ error: "Pick screens from the list" });
    expect(parseProposalInput({ ...ok, target_frames: "pickup/notify" }, frames)).toEqual({ error: "Pick screens from the list" });
  });
});

describe("modeFor", () => {
  it("varies one screen and versions the flow for several", () => {
    expect(modeFor(["a/b"])).toBe("variant");
    expect(modeFor([])).toBe("variant");
    expect(modeFor(["a/b", "c/d"])).toBe("round");
  });
});

describe("modeAfterEdit", () => {
  it("keeps the existing mode when the screens are unchanged", () => {
    expect(modeAfterEdit({ mode: "round", target_frames: ["a/b"] }, ["a/b"])).toBe("round");
    expect(modeAfterEdit({ mode: "variant", target_frames: ["a/b", "c/d"] }, ["c/d", "a/b"])).toBe("variant");
  });
  it("derives the mode again when the screens change", () => {
    expect(modeAfterEdit({ mode: "round", target_frames: ["a/b"] }, ["c/d"])).toBe("variant");
    expect(modeAfterEdit({ mode: "variant", target_frames: ["a/b"] }, ["a/b", "c/d"])).toBe("round");
  });
});

describe("defaultScreens", () => {
  it("starts from the recommended proposal's screens, else the last screen of the flow", () => {
    expect(defaultScreens([{ recommended: false, target_frames: ["a/x"] }, { recommended: true, target_frames: ["pickup/notify"] }], ["home/index", "pickup/notify"])).toEqual(["pickup/notify"]);
    expect(defaultScreens([], ["home/index", "pickup/notify"])).toEqual(["pickup/notify"]);
    expect(defaultScreens([{ recommended: true, target_frames: [] }], ["home/index"])).toEqual(["home/index"]);
    expect(defaultScreens([], [])).toEqual([]);
  });
});

describe("snapshotOriginal", () => {
  it("keeps only the editable fields and the mode", () => {
    expect(snapshotOriginal({ id: "s", rank: 1, title: "T", summary: "S", tradeoffs: null, effort: "M", risk: "low", mode: "variant", target_frames: ["a/b"], recommended: true })).toEqual({ title: "T", summary: "S", tradeoffs: null, effort: "M", risk: "low", mode: "variant", target_frames: ["a/b"] });
  });
});

describe("regeneratePlan", () => {
  const row = (id: string, origin: string, edited_at: string | null, rank: number, recommended = false) => ({ id, origin, edited_at, rank, recommended });
  it("replaces only untouched PMA proposals and ranks new ones after the kept", () => {
    expect(regeneratePlan([row("a", "ai", null, 1, true), row("b", "ai", "2026-10-15T10:00:00Z", 2), row("c", "pm", null, 3)])).toEqual({ deleteIds: ["a"], nextRank: 4, keptRecommended: false });
  });
  it("keeps one recommended when an edited recommended proposal survives", () => {
    expect(regeneratePlan([row("a", "ai", "2026-10-15T10:00:00Z", 1, true), row("b", "ai", null, 2)])).toEqual({ deleteIds: ["b"], nextRank: 2, keptRecommended: true });
  });
  it("starts at rank 1 when nothing is kept", () => expect(regeneratePlan([row("a", "ai", null, 1, true)])).toEqual({ deleteIds: ["a"], nextRank: 1, keptRecommended: false }));
});

describe("editLocked", () => {
  it("locks the proposal being drafted or already shipped, and nothing else", () => {
    expect(editLocked("drafting", "s1", "s1")).toBe("Drafting now. You can edit it when the draft is ready.");
    expect(editLocked("shipped", "s1", "s1")).toBe("Shipped");
    expect(editLocked("drafting", "s1", "s2")).toBeNull();
    expect(editLocked("review", "s1", "s1")).toBeNull();
    expect(editLocked("proposal_ready", null, "s1")).toBeNull();
  });
});

describe("changedSinceDraft", () => {
  const draft = { solution_id: "s1", created_at: "2026-10-15T10:00:00Z" };
  it("is true only for the drafted proposal edited after its draft started", () => {
    expect(changedSinceDraft({ id: "s1", edited_at: "2026-10-15T10:05:00Z" }, draft)).toBe(true);
    expect(changedSinceDraft({ id: "s1", edited_at: "2026-10-15T09:55:00Z" }, draft)).toBe(false);
    expect(changedSinceDraft({ id: "s2", edited_at: "2026-10-15T10:05:00Z" }, draft)).toBe(false);
    expect(changedSinceDraft({ id: "s1", edited_at: null }, draft)).toBe(false);
    expect(changedSinceDraft({ id: "s1", edited_at: "2026-10-15T10:05:00Z" }, null)).toBe(false);
  });
});

describe("provenanceLabel", () => {
  const me = "thomas.lewin@x.com";
  it("credits PMA, the editor, or the author", () => {
    expect(provenanceLabel({ origin: "ai", edited_at: null, edited_by_email: null }, me)).toEqual({ kind: "ai", label: "PMA" });
    expect(provenanceLabel({ origin: "ai", edited_at: "t", edited_by_email: me }, me)).toEqual({ kind: "edited", label: "Edited by you" });
    expect(provenanceLabel({ origin: "ai", edited_at: "t", edited_by_email: "jordan.smith@x.com" }, me)).toEqual({ kind: "edited", label: "Edited by JS" });
    expect(provenanceLabel({ origin: "pm", edited_at: "t", edited_by_email: me }, me)).toEqual({ kind: "pm", label: "Yours" });
    expect(provenanceLabel({ origin: "pm", edited_at: "t", edited_by_email: "jordan.smith@x.com" }, me)).toEqual({ kind: "pm", label: "By JS" });
    expect(provenanceLabel({ origin: "pm", edited_at: "t", edited_by_email: null }, null)).toEqual({ kind: "pm", label: "Written by your team" });
  });
});

describe("audienceNoun", () => {
  it("names who the change is for", () => {
    expect(audienceNoun(["users"], DEMO_PROFILE)).toBe("member");
    expect(audienceNoun(["staff"], DEMO_PROFILE)).toBe("staff member");
    expect(audienceNoun([], DEMO_PROFILE)).toBe("member");
    expect(audienceNoun(["leadership", "users"], DEMO_PROFILE)).toBe("member");
  });
});

describe("peopleWords", () => {
  const closet = { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } as const;
  it("counts people in the app's audience words, as the issue header does", () => {
    expect(peopleWords(1, ["users"], closet)).toBe("1 shopper");
    expect(peopleWords(3, ["users"], closet)).toBe("3 shoppers");
    expect(peopleWords(0, [], closet)).toBe("0 shoppers");
    expect(peopleWords(1.4, ["users", "staff"], closet)).toBe("1 shopper");
    expect(peopleWords(1.5, ["users"], closet)).toBe("2 shoppers");
    expect(peopleWords(1, ["staff"], closet)).toBe("1 staff member");
    expect(peopleWords(2, ["staff"], closet)).toBe("2 staff members");
  });
  it("says person and people for an app that has no profile yet", () => {
    const generic = profileOf({ kind: "customer", product_profile: null, name: "Closet" });
    expect(peopleWords(1, ["users"], generic)).toBe("1 person");
    expect(peopleWords(2, ["users"], generic)).toBe("2 people");
    expect(peopleWords(0, [], generic)).toBe("0 people");
  });
  it("counts the demo's members", () => {
    expect(peopleWords(1, ["users"], DEMO_PROFILE)).toBe("1 member");
    expect(peopleWords(4, ["users"], DEMO_PROFILE)).toBe("4 members");
  });
});

describe("peopleLabelFor", () => {
  const closet = { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } as const;
  it("counts a customer app's people in its audience words, as the issue header does", () => {
    expect(peopleLabelFor(1, ["users"], closet)).toBe("1 shopper");
    expect(peopleLabelFor(3, [], closet)).toBe("3 shoppers");
    expect(peopleLabelFor(2, ["staff"], closet)).toBe("2 staff members");
    expect(peopleLabelFor(1, ["users"], profileOf({ kind: "customer", product_profile: null, name: "Closet" }))).toBe("1 person");
    expect(peopleLabelFor(2, ["users"], profileOf({ kind: "customer", product_profile: null, name: "Closet" }))).toBe("2 people");
  });
  it("counts the demo's members, and keeps an app with no profile at person and people", () => {
    expect(peopleLabelFor(1, ["users"], DEMO_PROFILE)).toBe("1 member");
    expect(peopleLabelFor(4, ["users"], DEMO_PROFILE)).toBe("4 members");
    expect(peopleLabelFor(1, ["users"], null)).toBe("1 person");
    expect(peopleLabelFor(0, [], undefined)).toBe("0 people");
  });
});

describe("peopleTextFor (Slack's cards and alerts)", () => {
  const closet = { kind: "customer", name: "Closet", product_profile: { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } };
  it("says a customer app's people in its audience words, from the issue's pieces", () => {
    expect(peopleTextFor(closet, 1, [{ audience: "users" }, { audience: null }])).toBe("1 shopper");
    expect(peopleTextFor(closet, 3, [{ audience: "users" }, { audience: "staff" }])).toBe("3 shoppers");
    expect(peopleTextFor(closet, 2, [{ audience: "staff" }])).toBe("2 staff members");
    expect(peopleTextFor(closet, 2, [])).toBe("2 shoppers");
    expect(peopleTextFor(closet, 1, null)).toBe("1 shopper");
  });
  it("says person and people before the app is described", () => {
    const plain = { kind: "customer", name: "Closet", product_profile: null };
    expect(peopleTextFor(plain, 1, [{ audience: "users" }])).toBe("1 person");
    expect(peopleTextFor(plain, 2, [{ audience: "users" }])).toBe("2 people");
  });
  it("is nothing for the demo, or when the app didn't load, so their messages keep person and people", () => {
    expect(peopleTextFor({ kind: "demo", name: "Celeste", product_profile: null }, 1, [{ audience: "users" }])).toBeUndefined();
    expect(peopleTextFor(null, 1, [])).toBeUndefined();
    expect(peopleTextFor(undefined, 1, [])).toBeUndefined();
  });
});

describe("write your own in one box", () => {
  it("takes the words only, trimmed and capped", () => {
    expect(parseProposalText({ text: "  Show a Retry button.  " })).toEqual({ value: { text: "Show a Retry button." } });
    expect(parseProposalText({ text: "   " })).toEqual({ error: "Write what you would do" });
    expect(parseProposalText(null)).toEqual({ error: "Write what you would do" });
    expect(parseProposalText({ text: "x".repeat(1001) })).toEqual({ error: "Keep it under 1000 characters" });
  });
  it("tells the one-box body from the older title-and-summary form", () => {
    expect(isTextProposal({ text: "x" })).toBe(true);
    expect(isTextProposal({ title: "t", summary: "s" })).toBe(false);
    expect(isTextProposal({ text: "x", summary: "s" })).toBe(false);
    expect(isTextProposal(null)).toBe(false);
  });
  it("names it from the first sentence, eight words at most, until the model's name is back", () => {
    expect(fallbackTitle("show a Retry button when the thread can't load. Keep the header.")).toBe("Show a Retry button when the thread can't…");
    expect(fallbackTitle("Group the two shortcuts")).toBe("Group the two shortcuts");
    expect(fallbackTitle("Pin replies!\nAnd more")).toBe("Pin replies");
    expect(fallbackTitle("   ")).toBe("Your proposal");
  });
});
