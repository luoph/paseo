import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_PLUGIN_ICON_DELAY_MS,
  getLegacyWebScrollStyle,
  legacyPluginIconDelayMs,
  shouldAttachWebDragSensors,
} from "./legacy-web-interaction";

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

describe("legacy web sidebar interaction", () => {
  it("leaves drag sensors and the normal scroll style on desktop", () => {
    setLegacy(false);
    expect(shouldAttachWebDragSensors()).toBe(true);
    expect(getLegacyWebScrollStyle()).toBeNull();
    expect(legacyPluginIconDelayMs()).toBe(0);
  });

  it("drops the compositing transform and the touch drag sensors on Safari 12", () => {
    setLegacy(true);
    expect(shouldAttachWebDragSensors()).toBe(false);
    expect(getLegacyWebScrollStyle()).toEqual({
      transform: "none",
      WebkitOverflowScrolling: "touch",
    });
    expect(legacyPluginIconDelayMs()).toBe(LEGACY_PLUGIN_ICON_DELAY_MS);
  });
});
