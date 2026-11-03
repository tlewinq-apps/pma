import { describe, it, expect } from "vitest";
import { parseManifest, extractCopy, isArchivedScene, isProposalScene } from "@/lib/marver/manifest";
describe("marver manifest", () => {
  it("keeps tsx/html frames with required fields", () => {
    const frames = parseManifest({ frames: [
      { id: "pickup/notify", file: "design/scenes/pickup/notify.tsx", kind: "tsx", scene: "pickup", title: "Notify school" },
      { id: "broken" }, { id: "pickup/_fixtures", file: "x", kind: "ts", scene: "pickup" },
    ] });
    expect(frames.map((f) => f.id)).toEqual(["pickup/notify"]);
  });
  it("extracts visible copy from JSX text and labels", () => {
    const copy = extractCopy(`export const meta = { title: "Notify school" }\nexport default function F(){ return <div><h1>Early pickup</h1><Button aria-label="Send notice">Send</Button><input placeholder="Who is collecting?" /></div> }`);
    expect(copy).toContain("Early pickup"); expect(copy).toContain("Send"); expect(copy).toContain("Who is collecting?"); expect(copy).toContain("Send notice");
  });
  it("detects archived version scenes", () => { expect(isArchivedScene("pickup-v2")).toBe(true); expect(isArchivedScene("pickup")).toBe(false); });
  it("detects PMA's own proposal scenes", () => { expect(isProposalScene("pma-f8a002")).toBe(true); expect(isProposalScene("pickup")).toBe(false); });
});
