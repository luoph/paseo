import { afterEach, describe, expect, it } from "vitest";

import { validateLegacyWsOutboundMessage } from "./legacy-ws-outbound.js";
import { isWsOutboundValidatorReady, validateWsOutboundMessage } from "./ws-outbound-gate.js";

const FLAG = "__paseoLegacyLayoutViewport";

function setLegacy(enabled: boolean): void {
  if (enabled) {
    (globalThis as Record<string, unknown>)[FLAG] = true;
    return;
  }
  delete (globalThis as Record<string, unknown>)[FLAG];
}

afterEach(() => {
  setLegacy(false);
});

describe("validateLegacyWsOutboundMessage", () => {
  it("accepts pong, hello rejection, and a session envelope", () => {
    expect(validateLegacyWsOutboundMessage({ type: "pong" }).success).toBe(true);
    expect(
      validateLegacyWsOutboundMessage({
        type: "hello.rejected",
        reason: "password_required",
      }).success,
    ).toBe(true);
    const session = {
      type: "session",
      message: { type: "status", payload: { status: "ok", extra: true } },
    };
    const parsed = validateLegacyWsOutboundMessage(session);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(session);
  });

  it("rejects an envelope the client would not know how to route", () => {
    expect(validateLegacyWsOutboundMessage(null).success).toBe(false);
    expect(validateLegacyWsOutboundMessage({ type: "session", message: {} }).success).toBe(false);
    expect(
      validateLegacyWsOutboundMessage({ type: "hello.rejected", reason: "other" }).success,
    ).toBe(false);
  });
});

describe("legacy outbound gate", () => {
  it("accepts a partial session without the generated validator", () => {
    const partial = { type: "session", message: { type: "status" } };
    setLegacy(false);
    expect(isWsOutboundValidatorReady()).toBe(true);
    expect(validateWsOutboundMessage(partial).success).toBe(false);

    setLegacy(true);
    expect(isWsOutboundValidatorReady()).toBe(true);
    const parsed = validateWsOutboundMessage(partial);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(partial);
  });
});
