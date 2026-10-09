import { isLegacyLayoutViewport } from "@/utils/legacy-layout-viewport";

/** The mermaid iframe runtime is several megabytes and jetsams Safari 12. */
export const LEGACY_MERMAID_PREVIEW_CHARS = 2_000;

/**
 * Plain-text stand-in for a mermaid fence on Safari 12. Null means render the
 * real diagram. The preview is the start of the source, so the fence is still
 * readable and the iframe runtime never loads.
 */
export function legacyMermaidSourcePreview(language: string | null, code: string): string | null {
  if (language !== "mermaid" || !isLegacyLayoutViewport()) return null;
  if (code.length <= LEGACY_MERMAID_PREVIEW_CHARS) return code;
  return code.slice(0, LEGACY_MERMAID_PREVIEW_CHARS);
}
