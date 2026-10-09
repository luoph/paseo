import { createElement, type ReactElement } from "react";
import type { PluginIconProps } from "@getpaseo/plugin/client";
import type { LucideIcon } from "lucide-react-native";
import { legacyPluginIconDelayMs } from "@/utils/legacy-web-interaction";

type LucideModule = typeof import("lucide-react-native");

let lucideModule: LucideModule | null = null;
let loadPromise: Promise<void> | null = null;

export function arePluginIconsLoaded(): boolean {
  return lucideModule !== null;
}

function importPluginIcons(): Promise<void> {
  return import("lucide-react-native").then((mod) => {
    lucideModule = mod;
    return undefined;
  });
}

export function loadPluginIcons(): Promise<void> {
  if (!loadPromise) {
    const delayMs = legacyPluginIconDelayMs();
    const defer = delayMs > 0 && (typeof process === "undefined" || process.env.VITEST !== "true");
    loadPromise = defer
      ? new Promise((resolve, reject) => {
          setTimeout(() => {
            importPluginIcons().then(resolve, reject);
          }, delayMs);
        })
      : importPluginIcons();
  }
  return loadPromise;
}

function findPluginIcon(name: string): LucideIcon | null {
  if (!lucideModule) return null;
  const candidate = Reflect.get(lucideModule, name);
  if (candidate === lucideModule.Icon || candidate === lucideModule.createLucideIcon) return null;
  const isComponent =
    typeof candidate === "function" ||
    (typeof candidate === "object" && candidate !== null && "$$typeof" in candidate);
  return isComponent ? (candidate as LucideIcon) : null;
}

export function resolvePluginIcon(name: string): LucideIcon {
  if (!lucideModule) {
    throw new Error(`Lucide icons are still loading: ${name}`);
  }
  const icon = findPluginIcon(name);
  if (!icon) throw new Error(`Unknown Lucide icon: ${name}`);
  return icon;
}

export function Icon({ name, size, color }: PluginIconProps): ReactElement | null {
  const icon = findPluginIcon(name);
  return icon ? createElement(icon, { size, color }) : null;
}

// Safari 12 parses on the main thread. Desktop preloads the icon set after this
// script yields. The legacy build skips that preload; a later catalog request
// waits until the sidebar has had a turn before parsing the module.
if (
  (typeof process === "undefined" || process.env.VITEST !== "true") &&
  legacyPluginIconDelayMs() === 0
) {
  setTimeout(() => {
    void loadPluginIcons();
  }, 0);
}
