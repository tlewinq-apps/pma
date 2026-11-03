import { describe, it, expect, vi } from "vitest";
import { validateWidgetRequest, widgetCapExceeded, parseWidgetCap } from "@/lib/ingest/widget";
import { SUPPORTED_EXTS, unsupportedFiles, imageMediaType, ownedPath, uploadPath } from "@/lib/ingest/files";
import { recordingPath } from "@/lib/ingest/recording";
import { drainSources } from "@/lib/ingest/drain";
import { normalizeFile } from "@/lib/ingest/normalize";
import { contentHash, sourceHash } from "@/lib/text";

const project = { widget_origins: ["https://app.celeste.test"] };

describe("validateWidgetRequest", () => {
  it("accepts a valid request", () => {
    expect(validateWidgetRequest({ text: "Pickup failed", route: "/pickup/early", user: "u1" }, "https://app.celeste.test", project))
      .toEqual({ ok: true, text: "Pickup failed", route: "/pickup/early", user: "u1" });
  });
  it("404s an unknown key", () => expect(validateWidgetRequest({ text: "x" }, "https://a", null)).toMatchObject({ ok: false, status: 404 }));
  it("403s a disallowed origin", () => expect(validateWidgetRequest({ text: "x" }, "https://evil.test", project)).toMatchObject({ ok: false, status: 403 }));
  it("413s an oversized body", () => expect(validateWidgetRequest({ text: "a".repeat(5001) }, "https://app.celeste.test", project)).toMatchObject({ ok: false, status: 413 }));
  it("400s empty text", () => expect(validateWidgetRequest({ text: "   " }, "https://app.celeste.test", project)).toMatchObject({ ok: false, status: 400 }));
});

describe("normalizeFile", () => {
  it("passes through txt/md and strips captions from vtt", async () => {
    expect(await normalizeFile("a.md", Buffer.from("# hi"))).toBe("# hi");
    expect(await normalizeFile("a.vtt", Buffer.from("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nParent: Hi"))).toBe("Parent: Hi");
  });
  it("rejects unsupported types", async () => {
    await expect(normalizeFile("a.exe", Buffer.from("x"))).rejects.toThrow(/Unsupported/);
  });
});

describe("uploadPath", () => {
  it("keeps storage keys to safe characters, so a macOS screenshot name (narrow space before AM) can be stored", () => {
    expect(uploadPath("p1", "Screenshot 2026-10-16 at 9.41.00 AM.png", 7)).toBe("p1/7-Screenshot-2026-10-16-at-9.41.00-AM.png");
    expect(uploadPath("p1", "Café notes (final).docx", 7)).toBe("p1/7-Caf-notes-final.docx");
    expect(uploadPath("p1", "???.pdf", 7)).toBe("p1/7-file.pdf");
  });
});

describe("drainSources", () => {
  it("runs sources one at a time in order and hands the rest on once the time budget is used", async () => {
    let now = 0;
    const ran: string[] = [];
    const handOff = vi.fn(async () => {});
    await drainSources(["a", "b", "c", "d"], { process: async (id) => { ran.push(id); now += 70_000; }, handOff, now: () => now, budgetMs: 120_000 });
    expect(ran).toEqual(["a", "b"]);
    expect(handOff).toHaveBeenCalledWith(["c", "d"]);
  });
  it("always runs the first source, and hands nothing on when the batch fits", async () => {
    let now = 0;
    const ran: string[] = [];
    const handOff = vi.fn(async () => {});
    await drainSources(["a"], { process: async (id) => { ran.push(id); now += 500_000; }, handOff, now: () => now, budgetMs: 120_000 });
    await drainSources(["b", "c"], { process: async (id) => { ran.push(id); }, handOff, now: () => now, budgetMs: 120_000 });
    expect(ran).toEqual(["a", "b", "c"]);
    expect(handOff).not.toHaveBeenCalled();
  });
});

describe("duplicate detection", () => {
  it("duplicate pastes hash equal", () => expect(contentHash("Hello  world\n")).toBe(contentHash("hello world")));
  it("an explicit key (a Slack message) dedupes by key, not by text", () => {
    expect(sourceHash("same text", "slack:C1:1.1")).not.toBe(sourceHash("same text", "slack:C1:1.2"));
    expect(sourceHash("first edit", "slack:C1:1.1")).toBe(sourceHash("second edit", "slack:C1:1.1"));
    expect(sourceHash("Hello  world")).toBe(contentHash("hello world"));
    expect(sourceHash("slack:C1:1.1")).not.toBe(sourceHash("anything", "slack:C1:1.1"));
  });
});

describe("widget daily cap", () => {
  it("exceeds at or above the cap", () => {
    expect(widgetCapExceeded(199, 200)).toBe(false);
    expect(widgetCapExceeded(200, 200)).toBe(true);
    expect(widgetCapExceeded(201, 200)).toBe(true);
  });
  it("parses the env value with a default of 200", () => {
    expect(parseWidgetCap(undefined)).toBe(200);
    expect(parseWidgetCap("")).toBe(200);
    expect(parseWidgetCap("abc")).toBe(200);
    expect(parseWidgetCap("-5")).toBe(200);
    expect(parseWidgetCap("50")).toBe(50);
    expect(parseWidgetCap("0")).toBe(0);
  });
});

describe("file validation", () => {
  it("lists supported extensions", () => {
    expect([...SUPPORTED_EXTS].sort()).toEqual(["csv", "docx", "eml", "jpeg", "jpg", "md", "pdf", "png", "srt", "txt", "vtt", "webp"]);
  });
  it("reports unsupported files by name, case-insensitively", () => {
    expect(unsupportedFiles(["a.txt", "B.PDF", "x.exe", "noext", "y.zip"])).toEqual(["x.exe", "noext", "y.zip"]);
    expect(unsupportedFiles(["a.md"])).toEqual([]);
  });
  it("detects image media type by MIME with extension fallback", () => {
    expect(imageMediaType("shot.png", "image/png")).toBe("image/png");
    expect(imageMediaType("shot.jpg", "")).toBe("image/jpeg");
    expect(imageMediaType("shot.JPEG", "application/octet-stream")).toBe("image/jpeg");
    expect(imageMediaType("shot.webp", "")).toBe("image/webp");
    expect(imageMediaType("a.md", "text/plain")).toBeNull();
    expect(imageMediaType("a.gif", "image/gif")).toBeNull();
  });
});

describe("ownedPath (sources.file_path is member-writable, but the service role signs it)", () => {
  const P = "11111111-1111-4111-8111-111111111111";
  const Q = "22222222-2222-4222-8222-222222222222";

  it("keeps the paths this app's uploads get", () => {
    expect(ownedPath(P, uploadPath(P, "Screenshot 2026-10-16 at 9.41.00 AM.png", 7))).toBe(`${P}/7-Screenshot-2026-10-16-at-9.41.00-AM.png`);
    expect(ownedPath(P, recordingPath(P, "ab".repeat(32), "mp3"))).toBe(`${P}/audio/${"ab".repeat(32)}.mp3`);
  });

  it("treats a path in another app's folder, or outside any app's, as no file", () => {
    expect(ownedPath(P, uploadPath(Q, "notes.txt", 7))).toBeNull();
    expect(ownedPath(P, `${P}x/1-notes.txt`)).toBeNull(); // a longer id that merely starts with ours
    expect(ownedPath(P, "1-notes.txt")).toBeNull();
    expect(ownedPath(P, `/${P}/1-notes.txt`)).toBeNull();
  });

  it("refuses dot segments and characters a URL or Storage could reinterpret", () => {
    for (const bad of [`${P}/../${Q}/1-notes.txt`, `${P}/./1-notes.txt`, `${P}/`, `${P}//1-notes.txt`, `${P}/a%2e%2e/x`, `${P}/a b.txt`, `${P}/a\\b.txt`, `${P}/a?x=1`]) {
      expect(ownedPath(P, bad), bad).toBeNull();
    }
  });

  it("is null for no path or no project", () => {
    expect(ownedPath(P, null)).toBeNull();
    expect(ownedPath(P, undefined)).toBeNull();
    expect(ownedPath(P, "")).toBeNull();
    expect(ownedPath("", "/x")).toBeNull();
  });
});
