export const SUPPORTED_EXTS = ["txt", "md", "csv", "vtt", "srt", "eml", "docx", "pdf", "png", "jpg", "jpeg", "webp"] as const;
const extOf = (name: string) => (name.includes(".") ? name.toLowerCase().split(".").pop()! : "");

/** Names of files whose extension is not supported. */
export function unsupportedFiles(names: string[]): string[] {
  return names.filter((n) => !(SUPPORTED_EXTS as readonly string[]).includes(extOf(n)));
}

/**
 * Where an upload is stored. Supabase Storage rejects keys with characters outside a small safe set, and macOS puts a
 * narrow no-break space before AM/PM in every screenshot name, so the key keeps only safe characters; the real name
 * stays in the source's metadata.filename.
 */
export function uploadPath(projectId: string, name: string, stamp: number = Date.now()): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${projectId}/${stamp}-${base || "file"}${ext}`;
}

/**
 * `path` when it is an upload of this app (`<project_id>/...`, as uploadPath and recordingPath make them), else null.
 * sources.file_path is writable by the app's members, and the service role signs and transcribes it, so a path into
 * another app's folder, or one with "." / ".." segments or unusual characters that a URL could rewrite, counts as no file.
 */
export function ownedPath(projectId: string, path: string | null | undefined): string | null {
  if (!projectId || !path || !path.startsWith(`${projectId}/`)) return null;
  const rest = path.slice(projectId.length + 1).split("/");
  return rest.every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== "." && seg !== "..") ? path : null;
}

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";
/** Detect screenshots by MIME type, falling back to the file extension. */
export function imageMediaType(name: string, mime: string): ImageMediaType | null {
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") return mime;
  switch (extOf(name)) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return null;
  }
}
