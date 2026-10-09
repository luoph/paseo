// Safari 12 parses on the main thread. The generated validator is about 4 MB,
// and loading it after the workspace is up gets the tab killed. The daemon is
// already the user's host, so a shallow envelope check keeps frames moving.

type LegacyWsOutboundResult =
  | { success: true; data: unknown }
  | { success: false; error: { message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateLegacyWsOutboundMessage(input: unknown): LegacyWsOutboundResult {
  if (!isRecord(input) || typeof input.type !== "string") {
    return { success: false, error: { message: "Expected an outbound message" } };
  }

  if (input.type === "pong") {
    return { success: true, data: input };
  }

  if (input.type === "hello.rejected") {
    if (
      input.reason === "password_required" ||
      input.reason === "incorrect_password" ||
      input.reason === "incompatible_protocol"
    ) {
      return { success: true, data: input };
    }
    return { success: false, error: { message: "Unknown hello rejection" } };
  }

  if (
    input.type === "session" &&
    isRecord(input.message) &&
    typeof input.message.type === "string"
  ) {
    return { success: true, data: input };
  }

  return { success: false, error: { message: "Unknown outbound message" } };
}
