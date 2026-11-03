// Keeps the maintenance scripts away from the production Supabase project unless PMA_ALLOW_PROD=1 is set. Production
// is the project whose ref is PMA_PROD_SUPABASE_REF (in .env.local); with none set, no project counts as production.

/** The production project's ref, from PMA_PROD_SUPABASE_REF, or null when this checkout names none. */
export const prodRef = (): string | null => process.env.PMA_PROD_SUPABASE_REF?.trim() || null;

/** True when the Supabase URL (or a project ref) belongs to the production project. */
export function isProdUrl(url: string | undefined, ref?: string): boolean {
  const prod = prodRef();
  if (!prod) return false;
  if (ref === prod) return true;
  if (!url) return false;
  let host = url;
  try { host = new URL(url).hostname; } catch { /* not a URL: match on the raw text */ }
  return host.split(".").includes(prod);
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Throws when the app's Supabase URL points at production and PMA_ALLOW_PROD is not 1. */
export function assertNotProd(script: string): void {
  if (process.env.PMA_ALLOW_PROD === "1") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!isProdUrl(url)) return;
  throw new Error(`${script} refuses to run against production (${hostOf(url!)}). Set PMA_ALLOW_PROD=1 if you really mean it.`);
}
