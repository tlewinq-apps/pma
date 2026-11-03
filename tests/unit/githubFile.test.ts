import { describe, it, expect } from "vitest";
import { decodeFileResponse, isNotFound } from "@/lib/github/file";

describe("decodeFileResponse", () => {
  it("decodes base64 content", () => {
    expect(decodeFileResponse("p.tsx", { content: Buffer.from("hi").toString("base64"), encoding: "base64" })).toBe("hi");
  });
  it("throws naming the path when content is missing (large file or directory)", () => {
    expect(() => decodeFileResponse("big.tsx", { encoding: "none" })).toThrow(/big\.tsx/);
    expect(() => decodeFileResponse("dir", [])).toThrow(/dir/);
  });
});
describe("isNotFound", () => {
  it("true only for status 404", () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ status: 403 })).toBe(false);
    expect(isNotFound({ status: 500 })).toBe(false);
    expect(isNotFound(new Error("x"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
