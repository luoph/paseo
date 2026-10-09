import type { ViewStyle } from "react-native";

import { isLegacyLayoutViewport } from "@/utils/legacy-layout-viewport";

const LEGACY_WEB_SCROLL_STYLE = {
  // RN Web's ScrollView sets translateZ(0) together with overflow scrolling.
  // On iOS 12 that pair ignores swipes. A later transform replaces it.
  transform: "none",
  WebkitOverflowScrolling: "touch",
} as ViewStyle & { WebkitOverflowScrolling: "touch" };

/**
 * Safari 12 parses on the main thread. The full Lucide module is large enough
 * to freeze the sidebar during the first gestures, so legacy waits and then
 * loads it only after those gestures have had a turn.
 */
export const LEGACY_PLUGIN_ICON_DELAY_MS = 8000;

export function getLegacyWebScrollStyle():
  | (ViewStyle & { WebkitOverflowScrolling: "touch" })
  | null {
  return isLegacyLayoutViewport() ? LEGACY_WEB_SCROLL_STYLE : null;
}

/** dnd-kit's TouchSensor registers a window-level non-passive touchmove listener. */
export function shouldAttachWebDragSensors(): boolean {
  return !isLegacyLayoutViewport();
}

export function legacyPluginIconDelayMs(): number {
  return isLegacyLayoutViewport() ? LEGACY_PLUGIN_ICON_DELAY_MS : 0;
}
