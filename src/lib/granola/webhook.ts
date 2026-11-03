// Standard Webhooks signatures, as Granola sends them: webhook-id, webhook-timestamp and webhook-signature headers;
// the signature is "v1,<base64 HMAC-SHA256>" of "{id}.{timestamp}.{raw body}" keyed with the base64 part of the
// whsec_ secret. The header may carry several space-separated signatures (during secret rotation); any match passes.
// Deliveries older or newer than five minutes are refused, so a captured request can't be replayed.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 300;

export function signStandardWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

export function verifyStandardWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature || !/^\d+$/.test(h.timestamp)) return false;
  if (Math.abs(now / 1000 - Number(h.timestamp)) > TOLERANCE_S) return false;
  const expected = Buffer.from(signStandardWebhook(secret, h.id, h.timestamp, body).slice(3));
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
