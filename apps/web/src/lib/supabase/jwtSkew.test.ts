import { describe, expect, it } from "vitest";
import { isJwtIssuedAtFutureMessage, jwtIatWaitMs, parseJwtIatSeconds } from "./jwtSkew";

function jwtWithIat(iat: number): string {
  const payload = btoa(JSON.stringify({ iat })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `hdr.${payload}.sig`;
}

describe("jwt skew helpers", () => {
  it("detects PostgREST clock-skew errors", () => {
    expect(isJwtIssuedAtFutureMessage("JWT issued at future")).toBe(true);
    expect(isJwtIssuedAtFutureMessage('{"code":"PGRST303","message":"JWT issued at future"}')).toBe(true);
    expect(isJwtIssuedAtFutureMessage("JWT expired")).toBe(false);
  });

  it("reads iat from a JWT payload", () => {
    expect(parseJwtIatSeconds(jwtWithIat(1_700_000_000))).toBe(1_700_000_000);
    expect(parseJwtIatSeconds("not-a-jwt")).toBeNull();
  });

  it("waits only while iat is slightly in the future", () => {
    const now = 1_700_000_000_000;
    expect(jwtIatWaitMs(jwtWithIat(1_700_000_000 - 10), now)).toBe(0);
    expect(jwtIatWaitMs(jwtWithIat(1_700_000_002), now)).toBe(2400);
    expect(jwtIatWaitMs(jwtWithIat(1_700_000_000 + 60), now)).toBe(8_000);
  });
});
