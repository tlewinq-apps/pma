import { describe, it, expect } from "vitest";
import { appUrlProblem } from "../../scripts/cron-setup";

describe("cron:setup APP_URL check", () => {
  it("accepts a public https URL, including a host that merely starts with 'localhost'", () => {
    expect(appUrlProblem("https://my-app.vercel.app")).toBeNull();
    expect(appUrlProblem("https://my-app.vercel.app/")).toBeNull();
    expect(appUrlProblem("https://localhost-foo.example.com")).toBeNull();
  });

  it("refuses a scheme-less or malformed value instead of storing it", () => {
    expect(appUrlProblem("my-app.vercel.app")).toMatch(/isn't a full URL/);
    expect(appUrlProblem("")).toMatch(/isn't a full URL/);
  });

  it("refuses plain http, which would send the bearer token in the clear", () => {
    expect(appUrlProblem("http://example.com")).toMatch(/must be https/);
  });

  it.each([
    "https://localhost:3000",
    "https://foo.localhost",
    "https://127.0.0.1",
    "https://127.0.0.2:8443",
    "https://[::1]",
    "https://0.0.0.0",
    "https://LOCALHOST",
  ])("refuses loopback %s: the database can't reach it", (url) => {
    expect(appUrlProblem(url)).toMatch(/can't reach your laptop/);
  });

  it("tells http localhost, the value .env.local normally holds, that the database can't reach it", () => {
    expect(appUrlProblem("http://localhost:3000")).toMatch(/can't reach your laptop/);
  });
});
