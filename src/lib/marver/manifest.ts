export type ManifestFrame = { id: string; file: string; kind: "tsx" | "html"; scene: string; title?: string; description?: string; variantGroup?: string; variant?: string; note?: string };
export function parseManifest(json: unknown): ManifestFrame[] {
  const frames = ((json as { frames?: unknown[] })?.frames ?? []) as Partial<ManifestFrame>[];
  return frames.filter((f): f is ManifestFrame => typeof f?.id === "string" && typeof f.file === "string" && typeof f.scene === "string" && (f.kind === "tsx" || f.kind === "html"));
}
export function extractCopy(src: string): string {
  const out = new Set<string>();
  for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]{1,120}?)\s*</g)) out.add(m[1].trim());
  for (const m of src.matchAll(/(?:aria-label|placeholder|title|alt)=["']([^"']{1,120})["']/g)) out.add(m[1].trim());
  return [...out].filter((s) => /[a-z]/i.test(s)).join(" | ").slice(0, 2000);
}
export const isArchivedScene = (scene: string) => /-v\d+$/.test(scene);
/** PMA's own proposals, written into a canvas as `pma-<issue>` scenes: mock-ups, not the product's screens. */
export const isProposalScene = (scene: string) => scene.startsWith("pma-");
