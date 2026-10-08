// Builds a Safari 12 (iOS 12) compatible copy of the browser web export.
//
// The normal web export targets current browsers and ships ES2022+ syntax, so
// Safari 12 rejects the whole bundle at parse time and renders a blank page.
// This script post-processes an existing `expo export --platform web` output:
//   1. transpiles every emitted JS file down to Safari 12 syntax,
//   2. rewrites what Babel cannot lower (regex lookbehind, BigInt literals)
//      into runtime calls, so the bundle still parses,
//   3. prepends core-js plus hand-written shims (scripts/legacy-web/shims.js),
//   4. injects an on-screen error overlay into index.html,
//   5. verifies every JS file parses as ES2019.
//
// Usage: node scripts/build-legacy-web-ui.mjs [--input <dir>] [--output <dir>]
// Defaults: packages/app/dist -> packages/app/dist-legacy

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import { transformAsync } from "@babel/core";
import * as acorn from "acorn";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const LEGACY_DIR = path.join(__dirname, "legacy-web");

// iPad mini 2 / iPhone 5s top out at iOS 12.5, which ships Safari 12.1.
const BABEL_TARGETS = { safari: "12", ios: "12" };
const ESBUILD_TARGET = "safari12";
// Safari 12 parses all ES2019 syntax (optional catch binding, JSON superset).
const VERIFY_ECMA_VERSION = 2019;

const { values: options } = parseArgs({
  options: {
    input: { type: "string", default: path.join(REPO_ROOT, "packages", "app", "dist") },
    output: { type: "string", default: path.join(REPO_ROOT, "packages", "app", "dist-legacy") },
  },
});
const INPUT_DIR = path.resolve(options.input);
const OUTPUT_DIR = path.resolve(options.output);

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

async function listFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

function legacyBigIntCall(t, args) {
  return t.callExpression(
    t.memberExpression(t.identifier("globalThis"), t.identifier("__paseoLegacyBigInt")),
    args,
  );
}

function legacyLiteralsPlugin({ types: t }) {
  return {
    name: "paseo-legacy-literals",
    visitor: {
      RegExpLiteral(nodePath) {
        if (!/\(\?<[=!]/.test(nodePath.node.pattern)) {
          return;
        }
        nodePath.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier("globalThis"), t.identifier("__paseoLegacyRegExp")),
            [t.stringLiteral(nodePath.node.pattern), t.stringLiteral(nodePath.node.flags)],
          ),
        );
      },
      // BigInt ships in Safari 14. Libraries such as zod build BigInt
      // constants at module load, which would throw before the app renders.
      // Route those through a helper instead of defining a fake global, so
      // `typeof BigInt` feature detection elsewhere keeps reporting the truth.
      BigIntLiteral(nodePath) {
        nodePath.replaceWith(legacyBigIntCall(t, [t.stringLiteral(nodePath.node.value)]));
      },
      CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (
          t.isIdentifier(callee, { name: "BigInt" }) &&
          !nodePath.scope.hasBinding("BigInt", { noGlobals: true })
        ) {
          nodePath.replaceWith(legacyBigIntCall(t, nodePath.node.arguments));
        }
      },
    },
  };
}

async function transpileFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const result = await transformAsync(source, {
    babelrc: false,
    configFile: false,
    sourceType: "unambiguous",
    compact: true,
    comments: false,
    sourceMaps: false,
    presets: [
      [
        "@babel/preset-env",
        { targets: BABEL_TARGETS, bugfixes: true, modules: false, useBuiltIns: false },
      ],
    ],
    plugins: [legacyLiteralsPlugin],
  });
  if (!result?.code) {
    throw new Error(`Babel produced no output for ${filePath}`);
  }
  return result.code;
}

function verifyParses(code, label) {
  try {
    acorn.parse(code, { ecmaVersion: VERIFY_ECMA_VERSION, sourceType: "script" });
  } catch (error) {
    const pos = typeof error.pos === "number" ? error.pos : 0;
    const excerpt = code.slice(Math.max(0, pos - 80), pos + 40);
    throw new Error(
      `${label} does not parse as ES${VERIFY_ECMA_VERSION}: ${error.message}\n  near: ${JSON.stringify(excerpt)}`,
      { cause: error },
    );
  }
}

async function buildPolyfillBundle() {
  const result = await esbuild.build({
    stdin: {
      contents: 'import "core-js/stable";',
      resolveDir: REPO_ROOT,
      loader: "js",
    },
    bundle: true,
    format: "iife",
    target: ESBUILD_TARGET,
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const coreJs = result.outputFiles[0].text;
  const shims = await readFile(path.join(LEGACY_DIR, "shims.js"), "utf8");
  return `${coreJs}\n${shims}`;
}

function shortHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// Renames `name-<hash>.js` to `name-<hash>-legacy<buildId>.js` so browsers
// that cached a previous legacy build (hashed assets are served immutable)
// pick up the new one.
function legacyFileName(baseName, buildId) {
  return baseName.replace(/\.js$/, `-legacy${buildId}.js`);
}

// The daemon serves `.br` when the browser accepts brotli and falls back to
// the raw file (not `.gz`) when it is missing, so emit both.
async function compressFile(filePath) {
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }),
      createWriteStream(`${filePath}.br`),
    ),
    pipeline(
      createReadStream(filePath),
      createGzip({ level: 9 }),
      createWriteStream(`${filePath}.gz`),
    ),
  ]);
}

async function main() {
  const inputStat = await stat(INPUT_DIR).catch(() => null);
  if (!inputStat?.isDirectory()) {
    throw new Error(
      `Web export not found at ${INPUT_DIR}. Run \`npm run build:web --workspace=@getpaseo/app\` first.`,
    );
  }

  console.log(
    `Copying ${path.relative(REPO_ROOT, INPUT_DIR)} -> ${path.relative(REPO_ROOT, OUTPUT_DIR)}`,
  );
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await cp(INPUT_DIR, OUTPUT_DIR, { recursive: true });

  const allFiles = await listFiles(OUTPUT_DIR);
  for (const file of allFiles) {
    if (file.endsWith(".br") || file.endsWith(".gz") || file.endsWith(".map")) {
      await rm(file);
    }
  }

  const jsFiles = allFiles.filter((file) => file.endsWith(".js"));
  const transpiled = new Map();
  for (const file of jsFiles) {
    const label = path.relative(OUTPUT_DIR, file);
    const started = Date.now();
    const code = await transpileFile(file);
    verifyParses(code, label);
    transpiled.set(file, code);
    console.log(
      `  transpiled ${label} (${fmtMiB(code.length)}, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  }

  const polyfills = await buildPolyfillBundle();
  verifyParses(polyfills, "legacy polyfills");
  const overlay = await readFile(path.join(LEGACY_DIR, "error-overlay.js"), "utf8");
  verifyParses(overlay, "error overlay");

  const buildId = shortHash([polyfills, overlay, ...transpiled.values()].join("\n"));
  const renames = new Map();
  for (const file of jsFiles) {
    const baseName = path.basename(file);
    renames.set(baseName, legacyFileName(baseName, buildId));
  }
  function applyRenames(text) {
    let next = text;
    for (const [from, to] of renames) {
      next = next.split(from).join(to);
    }
    return next;
  }

  for (const [file, code] of transpiled) {
    await rm(file);
    await writeFile(
      path.join(path.dirname(file), renames.get(path.basename(file))),
      applyRenames(code),
    );
  }

  const jsDir = path.join(OUTPUT_DIR, "_expo", "static", "js", "web");
  const polyfillName = `legacy-polyfills-${buildId}.js`;
  await writeFile(path.join(jsDir, polyfillName), polyfills);

  const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = applyRenames(await readFile(file, "utf8"));
    const headInjection =
      `<script>${overlay}</script>` +
      `<script src="/_expo/static/js/web/${polyfillName}"></script>`;
    if (!/<head[^>]*>/i.test(html)) {
      throw new Error(`No <head> in ${file}`);
    }
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [, body] of inlineScripts) {
      if (body.trim()) {
        verifyParses(body, `inline script in ${path.relative(OUTPUT_DIR, file)}`);
      }
    }
    await writeFile(
      file,
      html.replace(/<head[^>]*>/i, (match) => `${match}${headInjection}`),
    );
  }

  let totalBytes = 0;
  for (const file of await listFiles(OUTPUT_DIR)) {
    totalBytes += (await stat(file)).size;
    if (/\.(js|html|css|json|svg)$/.test(file)) {
      await compressFile(file);
    }
  }

  console.log(
    `Legacy web UI written to ${path.relative(REPO_ROOT, OUTPUT_DIR)} (build ${buildId}, ${fmtMiB(totalBytes)} raw)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
