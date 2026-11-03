import { describe, it, expect } from "vitest";
import { AUDIO_EXTS, isAudio, MAX_RECORDING_BYTES, parseRecordingBody, recordingPath, sha256Hex, validateRecordingUpload } from "@/lib/ingest/recording";

const SHA = "a".repeat(64);

describe("isAudio", () => {
  it("recognises recordings by extension, whatever the case", () => {
    expect(AUDIO_EXTS).toEqual(["mp3", "m4a", "wav", "webm", "ogg"]);
    expect(["call.MP3", "a.m4a", "b.wav", "c.webm", "d.ogg"].every(isAudio)).toBe(true);
    expect(["notes.pdf", "mp3", "call.mp3.txt"].some(isAudio)).toBe(false);
  });
});

describe("validateRecordingUpload", () => {
  it("accepts an audio file under the size cap with a SHA-256", () => {
    expect(validateRecordingUpload({ filename: "Parent call.mp3", size: 1_000_000, sha256: SHA })).toEqual({ ok: true, ext: "mp3" });
  });
  it("rejects other file types, oversize files and bad hashes with a reason", () => {
    expect(validateRecordingUpload({ filename: "notes.pdf", size: 10, sha256: SHA })).toEqual({ ok: false, error: "Recordings must be MP3, M4A, WAV, WebM or OGG" });
    expect(validateRecordingUpload({ filename: "x.mp3", size: MAX_RECORDING_BYTES + 1, sha256: SHA })).toEqual({ ok: false, error: "Recordings can be up to 50 MB" });
    expect(validateRecordingUpload({ filename: "x.mp3", size: 0, sha256: SHA })).toEqual({ ok: false, error: "The file is empty" });
    expect(validateRecordingUpload({ filename: "x.mp3", size: 10, sha256: "nope" })).toEqual({ ok: false, error: "Bad file hash" });
    expect(validateRecordingUpload(null)).toEqual({ ok: false, error: "Bad request" });
  });
});

describe("recordingPath", () => {
  it("keys the stored file by project and content hash, so the same recording is stored once", () => {
    expect(recordingPath("proj-1", SHA, "m4a")).toBe(`proj-1/audio/${SHA}.m4a`);
  });
});

describe("parseRecordingBody", () => {
  const good = { path: `proj-1/audio/${SHA}.mp3`, filename: "call.mp3", sha256: SHA, who: "Priya Shah", when: "2026-10-14", where: "Parent coffee morning", participants: "Priya Shah (parent)", consent: true };
  it("accepts a recording stored under this project with consent", () => {
    expect(parseRecordingBody(good, "proj-1")).toEqual({ ok: true, value: good });
  });
  it("requires consent", () => {
    expect(parseRecordingBody({ ...good, consent: false }, "proj-1")).toEqual({ ok: false, error: "Confirm everyone in the recording agreed to it being used" });
  });
  it("refuses a path that does not belong to this project and hash", () => {
    expect(parseRecordingBody({ ...good, path: `other/audio/${SHA}.mp3` }, "proj-1")).toEqual({ ok: false, error: "Bad recording path" });
    expect(parseRecordingBody({ ...good, path: `proj-1/audio/${"b".repeat(64)}.mp3` }, "proj-1")).toEqual({ ok: false, error: "Bad recording path" });
  });
  it("trims optional text and drops empty values", () => {
    const r = parseRecordingBody({ ...good, who: "  ", when: "", where: undefined, participants: " Priya Shah " }, "proj-1");
    expect(r).toEqual({ ok: true, value: { ...good, who: null, when: null, where: null, participants: "Priya Shah" } });
  });
});

describe("sha256Hex", () => {
  it("hashes a file's bytes the way the browser does before upload, so the server can check what arrived", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new Blob([]))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
