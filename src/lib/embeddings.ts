import { env } from "@/lib/env";

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    // Keys made in MongoDB Atlas use https://ai.mongodb.com/v1; older Voyage platform keys use the default.
    const res = await fetch(`${process.env.VOYAGE_API_URL ?? "https://api.voyageai.com/v1"}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.voyageKey()}` },
      body: JSON.stringify({ model: "voyage-3.5", input: texts.slice(i, i + 128), input_type: inputType, output_dimension: 1024 }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}
export type Embedder = typeof embed;
