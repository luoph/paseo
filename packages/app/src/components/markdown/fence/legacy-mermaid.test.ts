import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_MERMAID_PREVIEW_CHARS, legacyMermaidSourcePreview } from "./legacy-mermaid";

const legacyFlag = "__paseoLegacyLayoutViewport";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[legacyFlag];
});

describe("legacyMermaidSourcePreview", () => {
  it("renders mermaid on a desktop viewport", () => {
    expect(legacyMermaidSourcePreview("mermaid", "graph TD; A-->B")).toBeNull();
  });

  it("returns a short source preview on Safari 12 and skips the iframe runtime", () => {
    (globalThis as Record<string, unknown>)[legacyFlag] = true;
    expect(legacyMermaidSourcePreview("ts", "const n = 1")).toBeNull();
    expect(legacyMermaidSourcePreview("mermaid", "graph TD; A-->B")).toBe("graph TD; A-->B");
    const source = "x".repeat(LEGACY_MERMAID_PREVIEW_CHARS + 50);
    expect(legacyMermaidSourcePreview("mermaid", source)).toHaveLength(
      LEGACY_MERMAID_PREVIEW_CHARS,
    );
  });
});
