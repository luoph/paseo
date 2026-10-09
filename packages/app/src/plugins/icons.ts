import { createElement, type ReactElement } from "react";
import type { PluginIconProps } from "@getpaseo/plugin/client";
import type { LucideIcon } from "lucide-react-native";

type LucideModule = typeof import("lucide-react-native");

let lucideModule: LucideModule | null = null;
let loadPromise: Promise<void> | null = null;

export function arePluginIconsLoaded(): boolean {
  return lucideModule !== null;
}

export function loadPluginIcons(): Promise<void> {
  if (!loadPromise) {
    loadPromise = import("lucide-react-native").then((mod) => {
      lucideModule = mod;
      return undefined;
    });
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

// Safari 12 parses on the main thread. The full icon set is requested after this
// script yields so the workspace shell can paint first. Plugin registration waits.
if (typeof process === "undefined" || process.env.VITEST !== "true") {
  setTimeout(() => {
    void loadPluginIcons();
  }, 0);
}
