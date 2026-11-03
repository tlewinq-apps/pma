// Recordings upload straight to Storage (signed upload URL), then a small JSON request turns the stored file into an
// `audio` source. These checks run on both requests.

export const AUDIO_EXTS = ["mp3", "m4a", "wav", "webm", "ogg"] as const;
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const extOf = (name: string) => (name.includes(".") ? name.toLowerCase().split(".").pop()! : "");

export const isAudio = (name: string) => (AUDIO_EXTS as readonly string[]).includes(extOf(name));

export function validateRecordingUpload(b: unknown): { ok: true; ext: string } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Bad request" };
  const { filename, size, sha256 } = b as Record<string, unknown>;
  if (typeof filename !== "string" || !isAudio(filename)) return { ok: false, error: "Recordings must be MP3, M4A, WAV, WebM or OGG" };
  if (typeof size !== "number" || size <= 0) return { ok: false, error: "The file is empty" };
  if (size > MAX_RECORDING_BYTES) return { ok: false, error: "Recordings can be up to 50 MB" };
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return { ok: false, error: "Bad file hash" };
  return { ok: true, ext: extOf(filename) };
}

/** Hex SHA-256 of a file's bytes. Web Crypto, so the browser (before upload) and the server (after) hash the same way. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keyed by content hash: uploading the same recording again overwrites one file and dedupes to one source. */
export const recordingPath = (projectId: string, sha256: string, ext: string) => `${projectId}/audio/${sha256}.${ext}`;

export type RecordingBody = {
  path: string; filename: string; sha256: string; who: string | null; when: string | null; where: string | null; participants: string | null; consent: true;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseRecordingBody(b: unknown, projectId: string): { ok: true; value: RecordingBody } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Bad request" };
  const r = b as Record<string, unknown>;
  const check = validateRecordingUpload({ filename: r.filename, size: 1, sha256: r.sha256 });
  if (!check.ok) return check;
  if (r.consent !== true) return { ok: false, error: "Confirm everyone in the recording agreed to it being used" };
  if (r.path !== recordingPath(projectId, r.sha256 as string, check.ext)) return { ok: false, error: "Bad recording path" };
  return {
    ok: true,
    value: { path: r.path, filename: r.filename as string, sha256: r.sha256 as string, who: text(r.who), when: text(r.when), where: text(r.where), participants: text(r.participants), consent: true },
  };
}
