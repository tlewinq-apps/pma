// npm run embed:snapshot — fills in embeddings for rows that have none: the snapshot seed (which makes no Voyage
// calls), and anything created while VOYAGE_API_KEY was unset. Run it once after adding a key; vector matching only
// sees embedded rows. Embeds the way the pipeline would: screens from title + description + copy, units from their
// quote, each issue from its first quote. Safe to re-run: only rows without an embedding are touched.
import { serviceDb } from "../src/lib/db/server";
import { embed } from "../src/lib/embeddings";

const vec = (v: number[]) => `[${v.join(",")}]`;

async function main() {
  const db = serviceDb();
  const { data: screens } = await db.from("screens").select("id, title, description, copy_text").is("embedding", null);
  if (screens?.length) {
    const v = await embed(screens.map((s) => [s.title, s.description, s.copy_text].filter(Boolean).join("\n")), "document");
    for (const [k, s] of screens.entries()) await db.from("screens").update({ embedding: vec(v[k]) }).eq("id", s.id);
  }
  const { data: units } = await db.from("feedback_units").select("id, quote").is("embedding", null).neq("type", "irrelevant");
  if (units?.length) {
    const v = await embed(units.map((u) => u.quote), "document");
    for (const [k, u] of units.entries()) await db.from("feedback_units").update({ embedding: vec(v[k]) }).eq("id", u.id);
  }
  const { data: issues } = await db.from("issues").select("id, title, feedback_units(quote, created_at)").is("embedding", null);
  const firstQuote = (i: { title: string; feedback_units: { quote: string; created_at: string }[] | null }) =>
    [...(i.feedback_units ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.quote ?? i.title;
  if (issues?.length) {
    const v = await embed(issues.map(firstQuote), "document");
    for (const [k, i] of issues.entries()) await db.from("issues").update({ embedding: vec(v[k]) }).eq("id", i.id);
  }
  console.log(`Embedded ${screens?.length ?? 0} screens, ${units?.length ?? 0} feedback units, ${issues?.length ?? 0} issues.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
