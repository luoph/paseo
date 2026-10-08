// Rewrites `import { Pencil } from "lucide-react-native"` into per-icon
// imports. The package entry re-exports every icon (~1,900 modules, ~2 MB) and
// Metro does not tree-shake, so a single named import executed all of them at
// startup; on an iPad mini 2 that was a visible share of launch time.
//
// `import * as Icons from "lucide-react-native"` (plugin icons, looked up by
// name) genuinely needs the whole set, so it becomes a lazy require that runs
// on first use instead. Vitest does not run this Babel config, so tests keep
// the plain ESM imports.
const fs = require("node:fs");
const path = require("node:path");

const PACKAGE = "lucide-react-native";

function loadExportMap() {
  const entry = require.resolve(PACKAGE);
  const packageDir = entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`));
  const barrel = fs.readFileSync(path.join(packageDir, "dist/esm/lucide-react-native.mjs"), "utf8");
  const icons = new Map();
  for (const match of barrel.matchAll(
    /export \{([^}]+)\} from ['"]\.\/(icons\/[^'"]+)\.mjs['"]/g,
  )) {
    for (const specifier of match[1].split(",")) {
      icons.set(
        specifier
          .trim()
          .split(/\s+as\s+/)
          .pop(),
        `${PACKAGE}/${match[2]}`,
      );
    }
  }
  if (icons.size === 0) {
    throw new Error(`${PACKAGE}: no icon re-exports found; the package layout changed`);
  }
  // The exports map does not expose context.mjs, so import it by file path.
  // Icons import the same file relatively, so they share one context module.
  const named = new Map([["LucideProvider", path.join(packageDir, "dist/esm/context.mjs")]]);
  return { icons, named };
}

function lazyNamespace(t, declarationPath, local) {
  const cache = declarationPath.scope.generateUidIdentifier("lucideIcons");
  const load = () =>
    t.logicalExpression(
      "||",
      t.cloneNode(cache),
      t.assignmentExpression(
        "=",
        t.cloneNode(cache),
        t.callExpression(t.identifier("require"), [t.stringLiteral(PACKAGE)]),
      ),
    );
  const binding = declarationPath.scope.getBinding(local.name);
  for (const reference of binding.referencePaths) {
    // `typeof Icons` in a type position is erased later; leave it alone.
    if (!reference.findParent((parent) => parent.isTSType())) {
      reference.replaceWith(load());
    }
  }
  declarationPath.replaceWith(
    t.variableDeclaration("let", [t.variableDeclarator(cache, t.nullLiteral())]),
  );
}

module.exports = function lucideDirectImports({ types: t }) {
  let exportMap = null;
  return {
    name: "lucide-direct-imports",
    visitor: {
      ImportDeclaration(declarationPath) {
        const { node } = declarationPath;
        if (node.source.value !== PACKAGE || node.importKind === "type") {
          return;
        }
        if (
          node.specifiers.length === 1 &&
          node.specifiers[0].type === "ImportNamespaceSpecifier"
        ) {
          lazyNamespace(t, declarationPath, node.specifiers[0].local);
          return;
        }
        exportMap = exportMap || loadExportMap();
        const kept = [];
        const direct = [];
        for (const specifier of node.specifiers) {
          const name =
            specifier.type === "ImportSpecifier" && specifier.importKind !== "type"
              ? specifier.imported.name || specifier.imported.value
              : null;
          if (exportMap.icons.has(name)) {
            direct.push(
              t.importDeclaration(
                [t.importDefaultSpecifier(specifier.local)],
                t.stringLiteral(exportMap.icons.get(name)),
              ),
            );
          } else if (exportMap.named.has(name)) {
            direct.push(
              t.importDeclaration(
                [t.importSpecifier(specifier.local, t.identifier(name))],
                t.stringLiteral(exportMap.named.get(name)),
              ),
            );
          } else {
            // Types (elided later by the TypeScript transform) and anything
            // unknown keep the package entry, which stays correct.
            kept.push(specifier);
          }
        }
        if (direct.length === 0) {
          return;
        }
        if (kept.length === 0) {
          declarationPath.replaceWithMultiple(direct);
        } else {
          node.specifiers = kept;
          declarationPath.insertAfter(direct);
        }
      },
    },
  };
};
