// What the Connect with GitHub hand-off came back with (?connect=github&ok=1 or &error=<reason>), in words.
export type GithubFlash = { ok: boolean; text: string } | null;

export const GITHUB_RETURN: Record<string, string> = {
  ok: "GitHub is connected. Pick the repository below.",
  not_yours: "GitHub didn't list that installation for your account. Press Connect with GitHub and install it again.",
  taken: "That GitHub installation is already connected to another PMA company.",
  requested: "Your GitHub organization's owners were asked to approve the PMA app. Connect again once they have.",
  denied: "Nothing was connected: the GitHub sign-in was cancelled.",
  expired: "That took too long. Press Connect with GitHub again.",
  wrong_user: "That GitHub hand-off was started by someone else. Press Connect with GitHub again.",
  unknown: "That GitHub hand-off didn't start here. Press Connect with GitHub again.",
  not_configured: "GitHub isn't set up on this deployment yet.",
  demo: "The demo's repository is managed by PMA.",
  failed: "It didn't finish connecting to GitHub. Try again in a moment.",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function githubFlashFrom(sp: Record<string, string | string[] | undefined>): GithubFlash {
  if (one(sp.connect) !== "github") return null;
  const error = one(sp.error);
  if (!error && one(sp.ok) === "1") return { ok: true, text: GITHUB_RETURN.ok };
  return { ok: false, text: GITHUB_RETURN[error ?? "failed"] ?? GITHUB_RETURN.failed };
}
