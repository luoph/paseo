type LegacyLayoutViewportGlobals = typeof globalThis & {
  __paseoLegacyLayoutViewport?: boolean;
};

/**
 * True only in the legacy web build on a browser with no visual viewport
 * (Safari 12). The shim sets the flag; desktop browsers that load the same
 * build leave it unset and keep the normal workspace and transcript limits.
 */
export function isLegacyLayoutViewport(): boolean {
  return (globalThis as LegacyLayoutViewportGlobals).__paseoLegacyLayoutViewport === true;
}
