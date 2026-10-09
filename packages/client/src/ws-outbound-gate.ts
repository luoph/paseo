// The generated validator is about 4 MB. Safari 12 parses on the main thread,
// and evaluating that chunk after the workspace is already up gets WebContent
// killed. The legacy build uses a shallow envelope check and never downloads
// it. Other browsers still load it after the entry script yields. Inbound
// frames stay in order until that chunk is ready. Do not replace it with Zod.

import { validateLegacyWsOutboundMessage } from "./legacy-ws-outbound.js";

type ValidateWSOutboundMessage =
  typeof import("@getpaseo/protocol/validation/ws-outbound").validateWSOutboundMessage;

type LegacyLayoutViewportGlobals = typeof globalThis & {
  __paseoLegacyLayoutViewport?: boolean;
};

function isLegacyWebViewport(): boolean {
  return (globalThis as LegacyLayoutViewportGlobals).__paseoLegacyLayoutViewport === true;
}

let validateWSOutboundMessage: ValidateWSOutboundMessage | null = null;
let loading: Promise<void> | null = null;
const queued: Array<() => void> = [];

function flushQueuedPayloads(): void {
  if (!validateWSOutboundMessage) return;
  const pending = queued.splice(0, queued.length);
  for (const deliver of pending) deliver();
}

function startLoadingValidator(): Promise<void> {
  if (isLegacyWebViewport() || validateWSOutboundMessage) return Promise.resolve();
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
  if (isLegacyWebViewport()) return Promise.resolve();
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
  return isLegacyWebViewport() || validateWSOutboundMessage !== null;
}

export function enqueueWsOutboundPayload(deliver: () => void): void {
  if (isLegacyWebViewport() || validateWSOutboundMessage) {
    deliver();
    return;
  }
  queued.push(deliver);
  void startLoadingValidator();
}

export function validateWsOutboundMessage(input: unknown): ReturnType<ValidateWSOutboundMessage> {
  if (isLegacyWebViewport()) {
    return validateLegacyWsOutboundMessage(input) as ReturnType<ValidateWSOutboundMessage>;
  }
  const validate = validateWSOutboundMessage;
  if (!validate) {
    throw new Error("Outbound validator is not loaded");
  }
  return validate(input);
}
