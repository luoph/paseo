import type { StreamItem } from "@/types/stream";
import { isLegacyLayoutViewport } from "@/utils/legacy-layout-viewport";

export const DEFAULT_MOUNTED_RECENT_STREAM_ITEMS = 20;
const LEGACY_MOUNTED_RECENT_STREAM_ITEMS = 4;
const LEGACY_MAX_MOUNTED_STREAM_ITEMS = 8;
const LEGACY_SPLIT_RECENT_SOURCE_ITEMS = 6;
const LEGACY_MARKDOWN_CHAR_BUDGET = 12_000;

type MountedRecentStreamItemsE2ETestGlobals = typeof globalThis & {
  __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
  __PASEO_E2E_WEB_MAX_MOUNTED_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as MountedRecentStreamItemsE2ETestGlobals)
      .__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return (
    override ??
    (isLegacyLayoutViewport()
      ? LEGACY_MOUNTED_RECENT_STREAM_ITEMS
      : DEFAULT_MOUNTED_RECENT_STREAM_ITEMS)
  );
}

/** How many source messages to Markdown-split when a session opens. */
export function getLegacySplitRecentCount(): number | undefined {
  return isLegacyLayoutViewport() ? LEGACY_SPLIT_RECENT_SOURCE_ITEMS : undefined;
}

/**
 * Characters of an assistant message to parse on Safari 12. The row cap still
 * mounts one giant fence in full, and that is enough to jetsam WebContent.
 */
export function getLegacyMarkdownCharBudget(): number | undefined {
  return isLegacyLayoutViewport() ? LEGACY_MARKDOWN_CHAR_BUDGET : undefined;
}

/**
 * Hard cap on rows kept in the mounted window. Safari 12 rewinds to the
 * previous user message, and one long turn would otherwise mount the whole
 * session. Unset on desktop, so the rewind stays unbounded there.
 */
export function getMaxMountedStreamItems(): number | undefined {
  const override = readPositiveIntegerOverride(
    (globalThis as MountedRecentStreamItemsE2ETestGlobals).__PASEO_E2E_WEB_MAX_MOUNTED_STREAM_ITEMS,
  );
  if (override) {
    return override;
  }
  return isLegacyLayoutViewport() ? LEGACY_MAX_MOUNTED_STREAM_ITEMS : undefined;
}

export function findMountedWindowStart(input: {
  items: StreamItem[];
  minMountedCount: number;
  maxMountedCount?: number;
}): number {
  const { items, minMountedCount, maxMountedCount } = input;
  if (items.length <= minMountedCount) {
    return 0;
  }

  let startIndex = Math.max(items.length - minMountedCount, 0);
  const floor =
    maxMountedCount !== undefined && maxMountedCount > 0
      ? Math.max(0, items.length - maxMountedCount)
      : 0;
  while (startIndex > floor && items[startIndex]?.kind !== "user_message") {
    startIndex -= 1;
  }
  return startIndex;
}
