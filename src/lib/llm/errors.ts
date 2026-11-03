// What a person reads when a Claude call fails: one plain sentence, never the API's raw JSON. The SDK's APIError message
// is "<status> <the response body as JSON>" ("400 {"type":"error","error":{...credit balance is too low...}}"), and that
// is what the first step, proposals and sources used to show. Pure and dependency-free (it reads errors by shape, not
// by class), so client components can map the error text already stored on a row too.

export const LLM_ERRORS = {
  // On PMA's own key (the demo, and during the beta a company that hasn't added its own), the credit is PMA's to add.
  credit: "PMA's Claude account is out of credit. Ask a PMA admin to add credit, then run it again.",
  key: "PMA's Claude key isn't valid. Ask an admin to check it.",
  // On the company's own key (src/lib/llm/client.ts says which), the company tops it up or replaces it.
  ownCredit: "Your Claude key is out of credit. Add credit in the Claude Console (Plans & Billing), then run it again.",
  ownKey: "Your Claude key isn't valid any more. An owner or admin replaces it in Settings.",
  busy: "Claude is busy right now. Try again in a minute.",
  overloaded: "Claude is overloaded right now. Try again in a minute.",
  claude: "Claude couldn't finish this. Try again in a minute.",
  unreachable: "Couldn't reach Claude. Try again in a minute.",
  generic: "Something went wrong. Try again.",
} as const;

/** What a model answer PMA couldn't use (LlmStageError in client.ts) means, by its reason. */
const STAGE: Record<string, string> = {
  refusal: "Claude declined to write this one. Try again, or write it yourself.",
  max_tokens: "Claude's answer was too long and got cut off. Try again.",
  no_text: "Claude sent back an empty answer. Try again.",
  invalid_json: "Claude's answer couldn't be read. Try again.",
};

const FRIENDLY = new Set<string>([...Object.values(LLM_ERRORS), ...Object.values(STAGE)]);
const OWN: string[] = [LLM_ERRORS.ownCredit, LLM_ERRORS.ownKey];
const MAX_PLAIN = 300;

type Shape = { status: number | null; text: string; reason: string | null };

/** The status, the text and (for an unusable answer) the reason, from an SDK error, any Error, or stored text. */
function shapeOf(e: unknown): Shape {
  if (typeof e === "string") {
    const m = /^(\d{3})\s/.exec(e);
    return { status: m ? Number(m[1]) : null, text: e, reason: null };
  }
  if (!e || typeof e !== "object") return { status: null, text: "", reason: null };
  const o = e as { status?: unknown; message?: unknown; reason?: unknown; error?: unknown };
  const body = o.error && typeof o.error === "object" ? JSON.stringify(o.error) : "";
  const message = typeof o.message === "string" ? o.message : "";
  return {
    status: typeof o.status === "number" ? o.status : (/^(\d{3})\s/.exec(message) ? Number(message.slice(0, 3)) : null),
    text: `${message} ${body}`.trim(),
    reason: typeof o.reason === "string" && o.reason in STAGE ? o.reason : null,
  };
}

/** One plain sentence for a failed Claude call (or any failed run): the API's errors by kind, PMA's own sentences as they are. */
export function friendlyLlmError(e: unknown): string {
  const { status, text, reason } = shapeOf(e);
  const t = text.trim();
  if (FRIENDLY.has(t)) return t;
  // The company's own key out of credit or refused (llm/client.ts ownKeyWording): an SDK error still carries its JSON body.
  const own = OWN.find((s) => t.startsWith(s));
  if (own) return own;
  // A row saved before the beta wording says "Your Claude account is out of credit…": it reads as today's sentence.
  if (/credit balance is too low|Claude account is out of credit/i.test(t)) return LLM_ERRORS.credit;
  if (status === 401 || status === 403 || /authentication_error|permission_error|invalid x-api-key/i.test(t)) return LLM_ERRORS.key;
  if (status === 429 || /rate_limit_error/i.test(t)) return LLM_ERRORS.busy;
  if (status === 529 || /overloaded_error/i.test(t)) return LLM_ERRORS.overloaded;
  if (reason) return STAGE[reason];
  // The SDK's connection errors carry no status: "Connection error." and "Request timed out."
  if (status === null && /^(Connection error|Request timed out)\.?$/i.test(t)) return LLM_ERRORS.unreachable;
  if (status !== null || /"type"\s*:\s*"error"/.test(t)) return LLM_ERRORS.claude;
  // Not an API error: a short plain sentence (PMA's own, such as "PMA needs a Claude key to read your code.") stays.
  if (t && t.length <= MAX_PLAIN && !/[{}[\]]/.test(t)) return t;
  return LLM_ERRORS.generic;
}
