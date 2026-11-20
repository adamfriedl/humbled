import { describe, expect, it } from "vitest";
import { validOwnerId } from "../lib/owner.ts";
import { clientIp, sameOrigin } from "../lib/request.ts";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("prefers Cloudflare's header, then the first X-Forwarded-For hop", () => {
    expect(clientIp(h({ "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "198.51.100.1",
    );
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("sameOrigin", () => {
  it("accepts our own origin or none, and rejects others", () => {
    expect(sameOrigin(h({ host: "dev.humbled.cv", origin: "https://dev.humbled.cv" }))).toBe(true);
    expect(sameOrigin(h({ host: "dev.humbled.cv" }))).toBe(true);
    expect(sameOrigin(h({ host: "dev.humbled.cv", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(h({ host: "dev.humbled.cv", origin: "null" }))).toBe(false);
  });
});

describe("validOwnerId", () => {
  it("only accepts a v4 UUID", () => {
    expect(validOwnerId("0b8f6a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b")).toBeDefined();
    expect(validOwnerId("not-a-uuid")).toBeUndefined();
    expect(validOwnerId(undefined)).toBeUndefined();
  });
});
