export function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { status?: number }).status === 404;
}

/** Decode a repos.getContent response; throws when there is no inline content (directory, or file over 1MB). */
export function decodeFileResponse(path: string, data: unknown): string {
  const d = data as { content?: string; encoding?: string } | unknown[];
  if (Array.isArray(d) || typeof d?.content !== "string" || d.content === "") {
    throw new Error(`GitHub returned no inline content for ${path} (directory, empty or over 1MB)`);
  }
  return Buffer.from(d.content, d.encoding && d.encoding !== "base64" ? (d.encoding as BufferEncoding) : "base64").toString("utf8");
}
