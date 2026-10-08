// Hand-written runtime shims for the legacy (Safari 12) web build, for gaps
// core-js does not cover. Loaded after the core-js bundle and css-compat.js,
// before the app.
// The build verifies this file parses as ES2019; keep it within that.
(() => {
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  // Set by the ResizeObserver fallback: style writes can resize elements.
  let afterStyleFlush = () => {};

  // Safari < 14 only has the deprecated MediaQueryList.addListener. Probe a real
  // matchMedia result instead of the MediaQueryList global: a check against the
  // global did not take effect on an iOS 12.5 iPad, and Unistyles crashed on its
  // first breakpoint listener.
  if (typeof g.matchMedia === "function") {
    const addEventListener = function addEventListener(type, listener) {
      if (type === "change") {
        this.addListener(listener);
      }
    };
    const removeEventListener = function removeEventListener(type, listener) {
      if (type === "change") {
        this.removeListener(listener);
      }
    };
    const needsShim = (mql) =>
      mql && typeof mql.addEventListener !== "function" && typeof mql.addListener === "function";

    const sample = g.matchMedia("all");
    if (needsShim(sample)) {
      const proto = Object.getPrototypeOf(sample);
      try {
        proto.addEventListener = addEventListener;
        proto.removeEventListener = removeEventListener;
      } catch {
        // Fall through to the per-instance wrapper below.
      }
      if (needsShim(g.matchMedia("all"))) {
        const matchMedia = g.matchMedia;
        g.matchMedia = function patchedMatchMedia(query) {
          const mql = matchMedia.call(g, query);
          if (needsShim(mql)) {
            mql.addEventListener = addEventListener;
            mql.removeEventListener = removeEventListener;
          }
          return mql;
        };
      }
    }
  }

  // Runtime CSS: Unistyles writes its <style> through innerText, the app sets
  // textContent, react-native-web calls insertRule. Route all three through
  // css-compat.js (concatenated before this file). Each rewrite is gated on
  // the feature being missing, because current browsers load this build too.
  const supportsFlexGap = () => {
    const root = document.body || document.documentElement;
    const probe = document.createElement("div");
    probe.style.cssText =
      "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
    probe.appendChild(document.createElement("div"));
    probe.appendChild(document.createElement("div"));
    root.appendChild(probe);
    const supported = probe.scrollHeight === 1;
    root.removeChild(probe);
    return supported;
  };
  const shimRuntimeCss = () => {
    const compat = g.paseoLegacyCss;
    if (
      !compat ||
      typeof HTMLStyleElement === "undefined" ||
      typeof CSSStyleSheet === "undefined"
    ) {
      return;
    }
    const options = {
      colorScheme: !["light", "dark"].some(
        (scheme) => g.matchMedia(`(prefers-color-scheme: ${scheme})`).matches,
      ),
      flexGap: !supportsFlexGap(),
    };
    const insertRule = CSSStyleSheet.prototype.insertRule;
    const textContent = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    let gapStyle = null;
    const gapRules = new Set();
    // The wrapping-container stand-ins carry plain class specificity, so this
    // sheet sits after react-native-web's (whose base `margin: 0` on every view
    // would cancel them) and before Unistyles' (so a child's own margins win).
    // Kept as text, not insertRule, because moving a <style> rebuilds its sheet
    // from text.
    const placeGapStyle = () => {
      const anchor = document.getElementById("react-native-stylesheet");
      if (anchor && anchor.parentNode) {
        if (gapStyle.previousSibling !== anchor) {
          anchor.parentNode.insertBefore(gapStyle, anchor.nextSibling);
        }
      } else if (!gapStyle.parentNode) {
        document.head.insertBefore(gapStyle, document.head.firstChild);
      }
    };
    const addGapRules = (rules) => {
      const fresh = rules.filter((rule) => !gapRules.has(rule));
      if (fresh.length === 0) {
        // react-native-web may create its sheet after the first gap rules.
        if (gapStyle) {
          placeGapStyle();
        }
        return;
      }
      for (const rule of fresh) {
        gapRules.add(rule);
      }
      if (!gapStyle) {
        gapStyle = document.createElement("style");
        gapStyle.id = "paseo-legacy-flex-gap";
      }
      textContent.set.call(gapStyle, [...gapRules].join("\n"));
      placeGapStyle();
    };
    const transform = (css) => {
      const result = compat.rewrite(css, options);
      addGapRules(result.gapRules);
      return result.css;
    };

    CSSStyleSheet.prototype.insertRule = function patchedInsertRule(rule, index) {
      return insertRule.call(this, transform(rule), index);
    };
    // Unistyles rewrites its whole sheet each time it adds a style, often a
    // dozen times in one React commit, and every write makes the browser
    // reparse the sheet and restyle the page. Writes made in the same task are
    // coalesced into one at the next microtask; layout reads flush first, so
    // code that measures right after rendering still sees current styles.
    // On an iPad mini 2 this cut settings-page switches by another ~15%.
    const pending = new Map();
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      const writes = [...pending];
      pending.clear();
      for (const [element, write] of writes) {
        write.set.call(element, transform(write.value));
      }
      afterStyleFlush();
    };
    const setters = [
      [Node.prototype, "textContent"],
      [HTMLElement.prototype, "innerText"],
    ];
    for (const [owner, prop] of setters) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, prop);
      if (descriptor && descriptor.set) {
        Object.defineProperty(HTMLStyleElement.prototype, prop, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get() {
            const write = pending.get(this);
            return write ? write.value : descriptor.get.call(this);
          },
          set(value) {
            pending.set(this, { set: descriptor.set, value: String(value) });
            if (!flushScheduled) {
              flushScheduled = true;
              Promise.resolve().then(flush);
            }
          },
        });
      }
    }
    const flushBeforeRead = (owner, name) => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (!descriptor) {
        return;
      }
      if (typeof descriptor.value === "function") {
        const read = descriptor.value;
        owner[name] = function flushedRead(...args) {
          if (pending.size > 0) {
            flush();
          }
          return read.apply(this, args);
        };
      } else if (descriptor.get) {
        Object.defineProperty(owner, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get() {
            if (pending.size > 0) {
              flush();
            }
            return descriptor.get.call(this);
          },
        });
      }
    };
    const windowOwner = Object.getOwnPropertyDescriptor(g, "getComputedStyle")
      ? g
      : Object.getPrototypeOf(g);
    flushBeforeRead(windowOwner, "getComputedStyle");
    flushBeforeRead(HTMLStyleElement.prototype, "sheet");
    for (const name of ["getBoundingClientRect", "getClientRects"]) {
      flushBeforeRead(Element.prototype, name);
    }
    for (const name of ["clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) {
      flushBeforeRead(Element.prototype, name);
    }
    for (const name of ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]) {
      flushBeforeRead(HTMLElement.prototype, name);
    }
  };
  shimRuntimeCss();

  // crypto.randomUUID ships in Safari 15.4.
  if (g.crypto && g.crypto.getRandomValues && !g.crypto.randomUUID) {
    g.crypto.randomUUID = () => {
      const bytes = new Uint8Array(16);
      g.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => (byte + 0x100).toString(16).slice(1)).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }

  // `new EventTarget()` throws "Illegal constructor" before Safari 14.
  let eventTargetConstructible;
  try {
    eventTargetConstructible = new g.EventTarget() instanceof g.EventTarget;
  } catch {
    eventTargetConstructible = false;
  }
  if (!eventTargetConstructible) {
    g.EventTarget = class EventTarget {
      constructor() {
        Object.defineProperty(this, "__listeners", { value: new Map() });
      }

      addEventListener(type, listener) {
        if (!listener) {
          return;
        }
        const list = this.__listeners.get(type) || [];
        if (!list.includes(listener)) {
          list.push(listener);
        }
        this.__listeners.set(type, list);
      }

      removeEventListener(type, listener) {
        const list = this.__listeners.get(type);
        if (list) {
          this.__listeners.set(
            type,
            list.filter((entry) => entry !== listener),
          );
        }
      }

      dispatchEvent(event) {
        try {
          Object.defineProperty(event, "target", { value: this, configurable: true });
          Object.defineProperty(event, "currentTarget", { value: this, configurable: true });
        } catch {
          // Native Event objects may refuse redefinition; listeners still run.
        }
        for (const listener of (this.__listeners.get(event.type) || []).slice()) {
          if (typeof listener === "function") {
            listener.call(this, event);
          } else if (listener && typeof listener.handleEvent === "function") {
            listener.handleEvent(event);
          }
        }
        return !event.defaultPrevented;
      }
    };
  }

  // AbortSignal.timeout ships in Safari 16.
  if (
    typeof AbortController !== "undefined" &&
    typeof AbortSignal !== "undefined" &&
    !AbortSignal.timeout
  ) {
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    };
  }

  // ResizeObserver ships in Safari 13.1. This fallback re-measures observed
  // elements in one shared check: every 250 ms, after style writes and on
  // window resize, at most once per frame. A MutationObserver trigger looked
  // more precise but measured slower on an iPad mini 2: React page switches
  // produce thousands of mutation records.
  if (typeof g.ResizeObserver === "undefined") {
    const observers = new Set();
    let frame = null;
    const checkAll = () => {
      frame = null;
      for (const observer of observers) {
        observer.poll();
      }
    };
    const scheduleCheck = () => {
      if (frame === null && observers.size > 0) {
        frame = requestAnimationFrame(checkAll);
      }
    };
    let watching = false;
    const watch = () => {
      if (watching) {
        return;
      }
      watching = true;
      g.addEventListener("resize", scheduleCheck);
      g.addEventListener("orientationchange", scheduleCheck);
      afterStyleFlush = scheduleCheck;
      setInterval(scheduleCheck, 250);
    };
    const toEntry = (target, rect) => {
      const box = { inlineSize: rect.width, blockSize: rect.height };
      return {
        target,
        contentRect: {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          width: rect.width,
          height: rect.height,
          right: rect.width,
          bottom: rect.height,
        },
        borderBoxSize: [box],
        contentBoxSize: [box],
      };
    };

    g.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.sizes = new Map();
      }

      poll() {
        const entries = [];
        for (const [target, prev] of this.sizes) {
          const rect = target.getBoundingClientRect();
          if (!prev || prev.width !== rect.width || prev.height !== rect.height) {
            this.sizes.set(target, { width: rect.width, height: rect.height });
            entries.push(toEntry(target, rect));
          }
        }
        if (entries.length > 0) {
          this.callback(entries, this);
        }
      }

      observe(target) {
        if (this.sizes.has(target)) {
          return;
        }
        this.sizes.set(target, null);
        observers.add(this);
        watch();
        scheduleCheck();
      }

      unobserve(target) {
        this.sizes.delete(target);
        if (this.sizes.size === 0) {
          observers.delete(this);
        }
      }

      disconnect() {
        this.sizes.clear();
        observers.delete(this);
      }
    };
  }

  // screen.orientation ships in Safari 16.4. Unistyles reads
  // screen.orientation.type at startup; derive it from the legacy
  // window.orientation angle and forward "change" to "orientationchange".
  const shimScreenOrientation = () => {
    if (typeof screen === "undefined" || screen.orientation) {
      return;
    }
    const angle = () => (typeof g.orientation === "number" ? g.orientation : 0);
    const orientation = {
      get angle() {
        return (angle() + 360) % 360;
      },
      get type() {
        if (typeof g.orientation !== "number") {
          return g.innerHeight >= g.innerWidth ? "portrait-primary" : "landscape-primary";
        }
        switch (angle()) {
          case 90:
            return "landscape-primary";
          case -90:
          case 270:
            return "landscape-secondary";
          case 180:
            return "portrait-secondary";
          default:
            return "portrait-primary";
        }
      },
      onchange: null,
      addEventListener(type, listener) {
        if (type === "change") {
          g.addEventListener("orientationchange", listener);
        }
      },
      removeEventListener(type, listener) {
        if (type === "change") {
          g.removeEventListener("orientationchange", listener);
        }
      },
    };
    Object.defineProperty(screen, "orientation", { configurable: true, get: () => orientation });
  };
  shimScreenOrientation();

  // WeakRef ships in Safari 14.1 and cannot be emulated. This fallback holds a
  // strong reference, so deref() never returns undefined and the target is
  // kept alive; callers only lose the memory optimisation.
  const shimWeakRef = () => {
    if (typeof g.WeakRef !== "undefined") {
      return;
    }
    g.WeakRef = class WeakRef {
      constructor(target) {
        Object.defineProperty(this, "__target", { value: target });
      }

      deref() {
        return this.__target;
      }
    };
  };
  shimWeakRef();

  // replaceChildren ships in Safari 14. xterm's DOM renderer clears and
  // repaints rows with it.
  const shimReplaceChildren = (Ctor) => {
    if (Ctor && !Ctor.prototype.replaceChildren) {
      Ctor.prototype.replaceChildren = function replaceChildren(...nodes) {
        while (this.lastChild) {
          this.removeChild(this.lastChild);
        }
        this.append(...nodes);
      };
    }
  };
  [g.Element, g.Document, g.DocumentFragment].forEach(shimReplaceChildren);

  // Safari has no requestIdleCallback at all; some components call it
  // unguarded from effects.
  const shimRequestIdleCallback = () => {
    if (typeof g.requestIdleCallback !== "undefined") {
      return;
    }
    g.requestIdleCallback = (callback) => {
      const start = Date.now();
      return setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
          }),
        1,
      );
    };
    g.cancelIdleCallback = (handle) => clearTimeout(handle);
  };
  shimRequestIdleCallback();

  // BigInt ships in Safari 14. The build rewrites `BigInt(x)` calls and BigInt
  // literals into this helper. Without native BigInt the value degrades to a
  // Number: module-level constants (zod's int64 ranges) load, and 64-bit
  // precision is lost only on code paths that actually need it.
  g.__paseoLegacyBigInt = (value) =>
    typeof g.BigInt === "function" ? g.BigInt(value) : Number(value);

  // Regex lookbehind ships in Safari 16.4 and cannot be transpiled. The build
  // rewrites lookbehind regex literals into calls to this helper, which drops
  // the lookbehind assertions when the engine rejects them. Matching becomes
  // slightly more permissive instead of the whole bundle failing to parse.
  const isLookbehindStart = (pattern, index) =>
    pattern.startsWith("(?<=", index) || pattern.startsWith("(?<!", index);

  // Returns the index just past the group that opens at `start`.
  const skipGroup = (pattern, start) => {
    let depth = 0;
    let inClass = false;
    let index = start;
    while (index < pattern.length) {
      const ch = pattern[index];
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (inClass) {
        inClass = ch !== "]";
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          return index + 1;
        }
      }
      index += 1;
    }
    return index;
  };

  const stripLookbehind = (pattern) => {
    let out = "";
    let inClass = false;
    let index = 0;
    while (index < pattern.length) {
      const ch = pattern[index];
      if (ch === "\\") {
        out += pattern.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (!inClass && isLookbehindStart(pattern, index)) {
        index = skipGroup(pattern, index);
        continue;
      }
      if (inClass) {
        inClass = ch !== "]";
      } else if (ch === "[") {
        inClass = true;
      }
      out += ch;
      index += 1;
    }
    return out;
  };

  g.__paseoLegacyRegExp = (pattern, flags) => {
    try {
      return new RegExp(pattern, flags);
    } catch {
      return new RegExp(stripLookbehind(pattern), flags);
    }
  };
})();
