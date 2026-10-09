// The generated validator is about 4 MB. Loading it from the entry script keeps
// Safari 12 parsing before the workspace shell can paint. Inbound frames stay
// in order until this chunk is ready. Do not replace it with Zod on the hot path.

type ValidateWSOutboundMessage =
  typeof import("@getpaseo/protocol/validation/ws-outbound").validateWSOutboundMessage;

let validateWSOutboundMessage: ValidateWSOutboundMessage | null = null;
let loading: Promise<void> | null = null;
const queued: Array<() => void> = [];

function flushQueuedPayloads(): void {
  if (!validateWSOutboundMessage) return;
  const pending = queued.splice(0, queued.length);
  for (const deliver of pending) deliver();
}

function startLoadingValidator(): Promise<void> {
  if (validateWSOutboundMessage) return Promise.resolve();
  if (!loading) {
    loading = import("@getpaseo/protocol/validation/ws-outbound")
      .then((mod) => {
        validateWSOutboundMessage = mod.validateWSOutboundMessage;
        loading = null;
        flushQueuedPayloads();
        return undefined;
      })
      .catch((error: unknown) => {
        loading = null;
        console.error("Failed to load the outbound message validator", error);
        throw error;
      });
  }
  return loading;
}

// Start after the entry script yields. Safari 12 parses on the main thread, so
// evaluating this chunk during startup keeps the shell off screen.
function beginInitialLoad(): Promise<void> {
  const defer = typeof process === "undefined" || process.env.VITEST !== "true";
  if (!defer) return startLoadingValidator();
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      startLoadingValidator().then(resolve, reject);
    }, 0);
  });
}

export const wsOutboundValidationReady: Promise<void> = beginInitialLoad();

export function isWsOutboundValidatorReady(): boolean {
  return validateWSOutboundMessage !== null;
}

export function enqueueWsOutboundPayload(deliver: () => void): void {
  if (validateWSOutboundMessage) {
    deliver();
    return;
  }
  queued.push(deliver);
  void startLoadingValidator();
}

export function validateWsOutboundMessage(input: unknown): ReturnType<ValidateWSOutboundMessage> {
  const validate = validateWSOutboundMessage;
  if (!validate) {
    throw new Error("Outbound validator is not loaded");
  }
  return validate(input);
}
