// One piece of feedback and what PMA read in it: who said it, how they feel, what it says happened to them and
// where in the app it happens. The feedback page lists these under the issue each piece joined.
import { audienceWords, EMOTION_LABEL, EMOTION_TONE, SENTIMENT_LABEL, SIGNAL_LABEL, matchLabel, type Emotion } from "@/components/triage/format";
import type { ProductProfile } from "@/lib/product/profile";

export type Piece = {
  id: string; quote: string; type: string; filtered_reason: string | null;
  sentiment: number | null; emotion: string | null; audience: string | null;
  speakers: string[]; corroborators: string[]; reported_count: number;
  signals: Record<string, boolean> | null;
  /** "Message thread, step 2 of 2 in Read a message", or the screen alone when it's on no flow. */
  where: string | null; match: number | null;
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0">{children}</dd></div>;
}

/** `roles` maps a recording's speaker names to the role the transcript gave them; `profile` names the app's audience. */
export function PieceReading({ p, author, roles, profile }: { p: Piece; author: string | null; roles: Map<string, string>; profile: ProductProfile }) {
  const set_aside = p.type === "question" || p.type === "irrelevant";
  // A set-aside line is often staff talking, so the person who sent it in isn't assumed to have said it.
  const names = p.speakers.filter((s) => s.trim()).length ? p.speakers : author && !set_aside ? [author] : [];
  const role = (n: string) => roles.get(n.trim().toLowerCase()) ?? (p.audience ? audienceWords(profile).one[p.audience] : undefined);
  const who = names.map((n) => (role(n) && role(n) !== "other" ? `${n}, ${role(n)}` : n));
  const signals = Object.entries(p.signals ?? {}).filter(([, on]) => on).map(([k]) => SIGNAL_LABEL[k]).filter(Boolean)
    .map((x, k) => (k ? x.charAt(0).toLowerCase() + x.slice(1) : x));
  const sentiment = p.sentiment == null ? null : SENTIMENT_LABEL[Math.max(-2, Math.min(2, Math.round(p.sentiment)))];
  return (
    <article id={`piece-${p.id}`} className="grid scroll-mt-6 gap-x-10 gap-y-4 px-6 py-5 target:bg-[rgb(235_76_23_/_0.05)] md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <blockquote className="font-heading text-[19px] leading-snug text-foreground/90">{p.quote}</blockquote>
      <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 text-[14px] leading-snug">
        <Row label="Who">
          {who.length ? andList(who) : <span className="text-muted-foreground">Not named</span>}
          {p.corroborators.length > 0 && <span className="block text-muted-foreground">{andList(p.corroborators)} agreed</span>}
          {p.reported_count > 0 && <span className="block text-muted-foreground">Plus {p.reported_count} {p.reported_count === 1 ? "other" : "others"} they mentioned</span>}
        </Row>
        {set_aside ? (
          <Row label="Set aside">{p.filtered_reason ? capital(p.filtered_reason) : p.type === "question" ? "A question, with no problem in it" : "Not about the product"}</Row>
        ) : (
          <>
            <Row label="How they feel">
              {p.emotion && <span className={`font-semibold ${EMOTION_TONE[p.emotion as Emotion] ?? ""}`}>{EMOTION_LABEL[p.emotion as Emotion] ?? capital(p.emotion)}</span>}
              {p.emotion && sentiment && ", "}
              {sentiment && <span className={p.emotion ? "text-muted-foreground" : ""}>{p.emotion ? sentiment.toLowerCase() : sentiment}</span>}
              {!p.emotion && !sentiment && <span className="text-muted-foreground">Not read yet</span>}
            </Row>
            {signals.length > 0 && <Row label="What happened">{andList(signals)}</Row>}
            <Row label="Where">
              {p.where ?? <span className="text-muted-foreground">Not matched to a screen</span>}
              {p.where && p.match != null && <span className="block text-muted-foreground">{matchLabel(p.match)}</span>}
            </Row>
          </>
        )}
      </dl>
    </article>
  );
}
