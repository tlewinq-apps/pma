import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
