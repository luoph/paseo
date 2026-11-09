import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { readConfiguredProviderIcon } from "./provider-icon.js";

test("relative icon paths cannot escape Paseo home through a symlink", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-configured-icon-"));
  const home = path.join(directory, "home");
  try {
    vi.stubEnv("PASEO_HOME", home);
    const outside = path.join(directory, "outside.svg");
    writeFileSync(outside, "<svg />");
    // resolvePaseoHome creates the home directory.
    expect(() => readConfiguredProviderIcon("missing.svg")).toThrow();
    symlinkSync(outside, path.join(home, "linked.svg"));
    expect(() => readConfiguredProviderIcon("linked.svg")).toThrow(
      "path leaves the Paseo home directory",
    );
    expect(readConfiguredProviderIcon(outside)).toBe("<svg />");
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
