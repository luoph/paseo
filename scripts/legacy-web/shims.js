// Hand-written runtime shims for the legacy (Safari 12) web build, for gaps
// core-js does not cover. Loaded after the core-js bundle and css-compat.js,
// before the app.
// The build verifies this file parses as ES2019; keep it within that.
(() => {
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  // Safari 12 has no visualViewport. The app uses this to mount one workspace
  // and only the tail of a conversation. Newer browsers that load this build
  // have visualViewport and keep the desktop limits.
  g.__paseoLegacyLayoutViewport = typeof g.visualViewport === "undefined";
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

  // Inline logical properties (Safari 14.1). overlay-root.ts pins every modal
  // and popover layer with `el.style.inset = "0"`; Safari 12 ignored it, left
  // the fixed layer at the end of <body> with no size, and modals rendered
  // off-screen. Writes through the style properties or setProperty are
  // expanded into physical longhands for each property the engine lacks.
  const shimInlineLogicalProperties = () => {
    const compat = g.paseoLegacyCss;
    if (!compat || typeof CSSStyleDeclaration === "undefined") {
      return;
    }
    const probe = document.createElement("div").style;
    const camelCase = (name) => name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const missing = compat.logicalProperties.filter((name) => !(camelCase(name) in probe));
    if (missing.length === 0) {
      return;
    }
    const proto = CSSStyleDeclaration.prototype;
    const setProperty = proto.setProperty;
    const removeProperty = proto.removeProperty;
    const write = (style, name, value, priority) => {
      if (value === null || value === undefined || String(value).trim() === "") {
        for (const [longhand] of compat.expandLogical(name, "0")) {
          removeProperty.call(style, longhand);
        }
        return;
      }
      for (const [longhand, longhandValue] of compat.expandLogical(name, value)) {
        setProperty.call(style, longhand, longhandValue, priority || "");
      }
    };
    for (const name of missing) {
      Object.defineProperty(proto, camelCase(name), {
        configurable: true,
        get() {
          return "";
        },
        set(value) {
          write(this, name, value);
        },
      });
    }
    proto.setProperty = function patchedSetProperty(name, value, priority) {
      if (missing.includes(name)) {
        write(this, name, value, priority);
        return undefined;
      }
      return setProperty.call(this, name, value, priority);
    };
  };
  shimInlineLogicalProperties();

  // element.animate (Web Animations, Safari 13.1). The status ring spins with
  // it, so on Safari 12 the sidebar threw as soon as a host with running agents
  // connected; dnd-kit's drop animation awaits `finished`. This fallback plays
  // the keyframes as a CSS animation and covers what those callers use:
  // duration, easing, delay, iterations, fill, startTime (timeline alignment),
  // cancel, finish, finished and onfinish.
  const shimElementAnimate = () => {
    if (typeof Element === "undefined" || Element.prototype.animate) {
      return;
    }
    let sequence = 0;
    let keyframesStyle = null;
    const IGNORED = new Set(["offset", "easing", "composite"]);
    const cssName = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const frameOffsets = (keyframes) => {
      if (Array.isArray(keyframes)) {
        return keyframes.map((frame, index) => ({
          offset:
            frame.offset !== null && frame.offset !== undefined
              ? frame.offset
              : index / Math.max(1, keyframes.length - 1),
          props: frame,
        }));
      }
      const keys = Object.keys(keyframes).filter((key) => !IGNORED.has(key));
      const count = Math.max(1, ...keys.map((key) => [].concat(keyframes[key]).length));
      return Array.from({ length: count }, (_unused, index) => {
        const props = {};
        for (const key of keys) {
          const values = [].concat(keyframes[key]);
          props[key] = values[Math.min(index, values.length - 1)];
        }
        return { offset: count === 1 ? 1 : index / (count - 1), props };
      });
    };
    const keyframesRule = (name, keyframes) => {
      const frames = frameOffsets(keyframes).map(({ offset, props }) => {
        const body = Object.keys(props)
          .filter((key) => !IGNORED.has(key))
          .map((key) => `${cssName(key)}:${props[key]}`)
          .join(";");
        return `${(offset * 100).toFixed(3)}%{${body}}`;
      });
      return `@keyframes ${name}{${frames.join("")}}`;
    };

    Element.prototype.animate = function legacyAnimate(keyframes, options) {
      const timing = typeof options === "number" ? { duration: options } : options || {};
      const element = this;
      const style = element.style;
      const name = `paseo-legacy-animation-${(sequence += 1)}`;
      if (!keyframesStyle) {
        keyframesStyle = document.createElement("style");
        keyframesStyle.id = "paseo-legacy-animations";
        document.head.appendChild(keyframesStyle);
      }
      const sheet = keyframesStyle.sheet;
      sheet.insertRule(keyframesRule(name, keyframes || {}), sheet.cssRules.length);

      const duration = Number(timing.duration) || 0;
      const iterations =
        timing.iterations === Number.POSITIVE_INFINITY ? "infinite" : timing.iterations || 1;
      const previousAnimation = style.animation;
      style.animation = [
        name,
        `${duration}ms`,
        timing.easing || "linear",
        `${Number(timing.delay) || 0}ms`,
        iterations,
        timing.direction || "normal",
        timing.fill || "none",
      ].join(" ");

      let resolveFinished;
      const finished = new Promise((resolve) => {
        resolveFinished = resolve;
      });
      let startTime = null;
      const cleanup = () => {
        element.removeEventListener("animationend", onEnd);
        if (style.animationName === name) {
          style.animation = previousAnimation || "";
        }
        for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
          if (sheet.cssRules[index].name === name) {
            sheet.deleteRule(index);
          }
        }
      };
      const animation = {
        playState: "running",
        finished,
        onfinish: null,
        oncancel: null,
        get startTime() {
          return startTime;
        },
        // A start time on the document timeline: shift the CSS animation so
        // its progress matches one that started then (keeps rings in sync).
        set startTime(value) {
          startTime = value;
          if (value !== null && value !== undefined) {
            style.animationDelay = `${Number(value) - performance.now()}ms`;
          }
        },
        cancel() {
          cleanup();
          animation.playState = "idle";
          if (typeof animation.oncancel === "function") {
            animation.oncancel({});
          }
        },
        finish() {
          // eslint-disable-next-line no-use-before-define -- assigned below
          onEnd({ animationName: name });
        },
        pause() {
          style.animationPlayState = "paused";
          animation.playState = "paused";
        },
        play() {
          style.animationPlayState = "running";
          animation.playState = "running";
        },
      };
      function onEnd(event) {
        if (event.animationName !== name || animation.playState === "finished") {
          return;
        }
        animation.playState = "finished";
        if (timing.fill !== "forwards" && timing.fill !== "both") {
          cleanup();
        }
        if (typeof animation.onfinish === "function") {
          animation.onfinish({});
        }
        resolveFinished(animation);
      }
      element.addEventListener("animationend", onEnd);
      return animation;
    };
  };
  shimElementAnimate();

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

  // iOS 12 Safari's layout viewport (html at height: 100%) stays taller than
  // the visible area while the toolbar is showing. On an iPad mini that is
  // 698px of layout against a 666px innerHeight, so the composer sits under
  // the toolbar. Pin the shell to the visible height. clientHeight stays at
  // the layout viewport after the write, so comparing it to innerHeight never
  // settles and every resize rewrites the shell. The style is the guard.
  const fitShellToVisibleViewport = () => {
    const apply = () => {
      const height = g.innerHeight;
      if (!height || !document.documentElement) {
        return;
      }
      const px = `${height}px`;
      const root = document.documentElement;
      if (root.style.height === px) {
        return;
      }
      root.style.height = px;
      if (document.body) {
        document.body.style.height = px;
      }
      const app = document.getElementById("root");
      if (app) {
        app.style.height = px;
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
    g.addEventListener("resize", apply);
    g.addEventListener("orientationchange", apply);
  };
  fitShellToVisibleViewport();

  // iOS 12 scrolls overflow:auto on the main thread unless this property is
  // set. The chat scroller sets it inline; sidebar and other React Native
  // ScrollViews only put overflow into the style attribute. A universal
  // selector would promote every layer and push WebContent toward jetsam.
  const enableTouchScrolling = () => {
    const apply = () => {
      if (!document.head || document.getElementById("paseo-legacy-touch-scroll")) {
        return;
      }
      const style = document.createElement("style");
      style.id = "paseo-legacy-touch-scroll";
      style.textContent =
        [
          '[style*="overflow-y:auto"]',
          '[style*="overflow-y: auto"]',
          '[style*="overflow-y:scroll"]',
          '[style*="overflow-y: scroll"]',
          '[style*="overflow:auto"]',
          '[style*="overflow: auto"]',
          '[style*="overflow:scroll"]',
          '[style*="overflow: scroll"]',
        ].join(",") + "{-webkit-overflow-scrolling:touch}";
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
  };
  enableTouchScrolling();
})();
