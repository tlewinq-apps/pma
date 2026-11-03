import { describe, it, expect } from "vitest";
import { createDemoDraft } from "@/lib/drafts/demoRepo";

/** Just enough of a Supabase client to record what createDemoDraft writes. */
function fakeDb() {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const chain = { eq: async () => ({ data: null, error: null }) };
  const db = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => { inserts.push({ table, row }); return { select: () => ({ single: async () => ({ data: { id: "draft-1" }, error: null }) }), then: (r: (v: unknown) => void) => r({ data: null, error: null }) }; },
      update: () => chain,
    }),
  };
  return { db, inserts };
}

describe("createDemoDraft", () => {
  it("records the draft as a demo-renderer draft, so the workspace says it takes seconds", async () => {
    const { db, inserts } = fakeDb();
    expect(await createDemoDraft(db as never, { id: "i1", short_id: "NF-1", title: "Early pickup" }, { id: "s1", title: "Sent states", mode: "variant" })).toBe(true);
    expect(inserts.find((x) => x.table === "drafts")?.row).toMatchObject({ demo: true, backend: "demo" });
  });
});
