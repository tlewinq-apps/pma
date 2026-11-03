import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack retries are signed again with a new timestamp, so anything older than this is a replay. */
const MAX_SKEW_S = 300;

/** Slack's v0 request signature: HMAC-SHA256 of `v0:{timestamp}:{raw body}`. Mirrors verifyGithubSignature. */
export function verifySlackSignature(secret: string, raw: string, ts: string | null, sig: string | null, now = Date.now()): boolean {
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > MAX_SKEW_S) return false;
  const expected = Buffer.from("v0=" + createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex"));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
