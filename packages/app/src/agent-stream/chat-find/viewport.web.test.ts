import { expect, it } from "vitest";
import { createFindViewport } from "./viewport.web";

it("clears when the browser has no CSS highlight registry", () => {
  const previous = globalThis.CSS;
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: {} });
  try {
    const viewport = createFindViewport({
      getBindings: () => {
        throw new Error("unused");
      },
      getRoot: () => null,
      highlightName: "paseo-chat-find-missing",
    });
    expect(() => viewport.clear()).not.toThrow();
  } finally {
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: previous });
  }
});
