// CSS rewrites for the legacy (Safari 12) web build. Pure string functions with
// no DOM access: shims.js runs them over CSS that libraries generate in the
// browser, and the build runs them over static .css files.
// The build verifies this file parses as ES2019; keep it within that.
//
// Safari 12 drops declarations it does not know and drops whole rules whose
// selector it cannot parse, so most modern CSS fails silently: elements lose
// padding, positioning or colors instead of throwing.
// eslint-disable-next-line no-unused-vars -- read as a global by shims.js and the build
var paseoLegacyCss = (() => {
  // Splits on `separator` at parenthesis depth 0, so `var(--a, 1px)` and
  // `rgba(0, 0, 0, 0.5)` stay whole.
  const splitTopLevel = (text, separator) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
      } else if (depth === 0 && separator.test(ch)) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  };

  // Logical properties ship in Safari 14.1 (`inset` too). The app is LTR, so
  // inline start/end map to left/right.
  const LOGICAL = {
    "padding-block": ["padding-top", "padding-bottom"],
    "padding-inline": ["padding-left", "padding-right"],
    "margin-block": ["margin-top", "margin-bottom"],
    "margin-inline": ["margin-left", "margin-right"],
    "inset-block": ["top", "bottom"],
    "inset-inline": ["left", "right"],
  };
  const LOGICAL_LONGHAND = {
    "padding-block-start": "padding-top",
    "padding-block-end": "padding-bottom",
    "padding-inline-start": "padding-left",
    "padding-inline-end": "padding-right",
    "margin-block-start": "margin-top",
    "margin-block-end": "margin-bottom",
    "margin-inline-start": "margin-left",
    "margin-inline-end": "margin-right",
    "inset-block-start": "top",
    "inset-block-end": "bottom",
    "inset-inline-start": "left",
    "inset-inline-end": "right",
  };

  const expandDeclaration = (prop, value, important) => {
    const suffix = important ? " !important" : "";
    if (LOGICAL[prop]) {
      const [first, second = first] = splitTopLevel(value, /\s/);
      return `${LOGICAL[prop][0]}:${first}${suffix};${LOGICAL[prop][1]}:${second}${suffix}`;
    }
    if (LOGICAL_LONGHAND[prop]) {
      return `${LOGICAL_LONGHAND[prop]}:${value}${suffix}`;
    }
    if (prop === "inset") {
      const [top, right = top, bottom = top, left = right] = splitTopLevel(value, /\s/);
      return `top:${top}${suffix};right:${right}${suffix};bottom:${bottom}${suffix};left:${left}${suffix}`;
    }
    return null;
  };

  // Rewrites one declaration block. Also reports the flex gap and direction so
  // the caller can emulate flex `gap` (Safari 14.1) with child margins.
  const rewriteDeclarations = (body) => {
    const layout = { rowGap: null, columnGap: null, direction: null, wrap: null };
    const out = splitTopLevel(body, /;/).map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) {
        return declaration;
      }
      const prop = declaration.slice(0, colon).trim().toLowerCase();
      let value = declaration.slice(colon + 1).trim();
      const important = /!important$/i.test(value);
      if (important) {
        value = value.replace(/\s*!important$/i, "");
      }
      if (prop === "gap") {
        const [row, column = row] = splitTopLevel(value, /\s/);
        layout.rowGap = row;
        layout.columnGap = column;
      } else if (prop === "row-gap") {
        layout.rowGap = value;
      } else if (prop === "column-gap") {
        layout.columnGap = value;
      } else if (prop === "flex-direction") {
        layout.direction = value;
      } else if (prop === "flex-wrap") {
        layout.wrap = value;
      } else if (prop === "flex-flow") {
        for (const token of splitTopLevel(value, /\s/)) {
          if (/^(row|column)/.test(token)) {
            layout.direction = token;
          } else if (/wrap/.test(token)) {
            layout.wrap = token;
          }
        }
      }
      return expandDeclaration(prop, value, important) || declaration;
    });
    return { body: out.join(";"), layout };
  };

  // `:is()` ships in Safari 14. Expands `:is(a, b) c` into `a c, b c`.
  const expandIs = (selector) => {
    const start = selector.indexOf(":is(");
    if (start === -1) {
      return [selector];
    }
    let depth = 0;
    let end = start + 3;
    for (; end < selector.length; end += 1) {
      if (selector[end] === "(") {
        depth += 1;
      } else if (selector[end] === ")") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    const before = selector.slice(0, start);
    const after = selector.slice(end + 1);
    const options = splitTopLevel(selector.slice(start + 4, end), /,/);
    return options.reduce((all, option) => all.concat(expandIs(`${before}${option}${after}`)), []);
  };

  const rewriteSelector = (selector) =>
    splitTopLevel(selector, /,/).reduce((all, part) => all.concat(expandIs(part)), []);

  const isZero = (value) => value === null || /^0(px|rem|em|%)?$/.test(value);

  const wrapRule = (layout) => {
    const sides = [];
    if (!isZero(layout.columnGap)) {
      const side = (layout.direction || "").endsWith("reverse") ? "left" : "right";
      sides.push(`margin-${side}:${layout.columnGap}`);
    }
    if (!isZero(layout.rowGap)) {
      sides.push(`margin-${layout.wrap === "wrap-reverse" ? "top" : "bottom"}:${layout.rowGap}`);
    }
    return sides.join(";");
  };

  // Child-margin rules that stand in for flex `gap`. Direction comes from the
  // same rule; React Native defaults to column when the rule does not say.
  // Wrapping containers give every child trailing margins instead, so items
  // that wrap onto a new line are spaced too; the cost is one extra gap after
  // the last item of each line.
  const gapRules = (selectors, layout, wrappers) => {
    const targets = selectors.filter((selector) => selector.indexOf("::") === -1);
    if (targets.length === 0) {
      return [];
    }
    const wrap = (rule) => [wrappers.reduceRight((inner, prelude) => `${prelude}{${inner}}`, rule)];
    if (layout.wrap && layout.wrap !== "nowrap") {
      const body = wrapRule(layout);
      return body ? wrap(`${targets.map((selector) => `${selector} > *`).join(",")}{${body}}`) : [];
    }
    const direction = layout.direction || "column";
    const horizontal = direction.indexOf("row") === 0;
    const value = horizontal ? layout.columnGap : layout.rowGap;
    if (isZero(value)) {
      return [];
    }
    const reverse = direction.endsWith("reverse");
    let side = horizontal ? "left" : "top";
    if (reverse) {
      side = horizontal ? "right" : "bottom";
    }
    return wrap(
      `${targets.map((selector) => `${selector} > * + *`).join(",")}{margin-${side}:${value}}`,
    );
  };

  const findBlockEnd = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") {
        depth += 1;
      } else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
    }
    return text.length;
  };

  const GROUPING_AT_RULE = /^@(media|supports|document)\b/i;
  const LIGHT_SCHEME_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)$/i;

  const rewriteBlock = (prelude, inner, options, wrappers, gaps) => {
    if (prelude[0] !== "@") {
      const selectors = rewriteSelector(prelude);
      const { body, layout } = rewriteDeclarations(inner);
      if (options.flexGap) {
        gaps.push(...gapRules(selectors, layout, wrappers));
      }
      return `${selectors.join(",")}{${body}}`;
    }
    if (GROUPING_AT_RULE.test(prelude)) {
      // Without prefers-color-scheme support, the light theme block is the one
      // the app expects; explicit theme classes on :root still override it.
      const nextPrelude =
        options.colorScheme && LIGHT_SCHEME_MEDIA.test(prelude) ? "@media all" : prelude;
      // eslint-disable-next-line no-use-before-define -- mutual recursion
      return `${nextPrelude}{${rewriteRules(inner, options, wrappers.concat(nextPrelude), gaps)}}`;
    }
    if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
      // eslint-disable-next-line no-use-before-define -- mutual recursion
      return `${prelude}{${rewriteRules(inner, {}, wrappers, gaps)}}`;
    }
    return `${prelude}{${inner}}`;
  };

  // Unistyles rewrites its whole stylesheet (60 KB+ on real screens) every
  // time it adds a style, so nearly every top-level rule repeats from the
  // previous call. Measured on an iPad mini 2, rewriting without this cache
  // took 1.6 s across eight settings-page switches.
  const blockCache = new Map();
  const MAX_CACHED_BLOCKS = 20000;

  const rewriteRules = (text, options, wrappers, gaps) => {
    const cacheable = wrappers.length === 0;
    const flags = `${options.colorScheme ? 1 : 0}${options.flexGap ? 1 : 0}|`;
    let out = "";
    let pos = 0;
    while (pos < text.length) {
      const brace = text.indexOf("{", pos);
      const semicolon = text.indexOf(";", pos);
      if (brace === -1) {
        out += text.slice(pos);
        break;
      }
      if (semicolon !== -1 && semicolon < brace) {
        // Statement at-rule such as @import or @charset.
        out += text.slice(pos, semicolon + 1);
        pos = semicolon + 1;
        continue;
      }
      const end = findBlockEnd(text, brace);
      const prelude = text.slice(pos, brace).trim();
      const inner = text.slice(brace + 1, end);
      if (cacheable) {
        const key = `${flags}${prelude}{${inner}}`;
        let hit = blockCache.get(key);
        if (!hit) {
          const blockGaps = [];
          hit = {
            css: rewriteBlock(prelude, inner, options, wrappers, blockGaps),
            gaps: blockGaps,
          };
          if (blockCache.size >= MAX_CACHED_BLOCKS) {
            blockCache.clear();
          }
          blockCache.set(key, hit);
        }
        out += hit.css;
        gaps.push(...hit.gaps);
      } else {
        out += rewriteBlock(prelude, inner, options, wrappers, gaps);
      }
      pos = end + 1;
    }
    return out;
  };

  // options.colorScheme: rewrite the light prefers-color-scheme block to `all`.
  // options.flexGap: collect child-margin rules that emulate flex `gap`.
  // Returns the rewritten CSS and the gap rules, which callers place in an
  // early stylesheet so children's own margins still win.
  let last = { input: null, flags: null, result: null };
  const rewrite = (css, options) => {
    const opts = options || {};
    const input = String(css);
    const flags = `${opts.colorScheme ? 1 : 0}${opts.flexGap ? 1 : 0}`;
    if (last.input === input && last.flags === flags) {
      return last.result;
    }
    const gaps = [];
    const text = input.indexOf("/*") === -1 ? input : input.replace(/\/\*[\s\S]*?\*\//g, "");
    const result = { css: rewriteRules(text, opts, [], gaps), gapRules: gaps };
    last = { input, flags, result };
    return result;
  };

  return { rewrite };
})();
