// Hand-written runtime shims for the legacy (Safari 12) web build, for gaps
// core-js does not cover. Loaded after the core-js bundle, before the app.
// The build verifies this file parses as ES2019; keep it within that.
(() => {
  const g = typeof globalThis !== "undefined" ? globalThis : window;

  // Safari < 14 only has the deprecated MediaQueryList.addListener.
  if (
    typeof MediaQueryList !== "undefined" &&
    !MediaQueryList.prototype.addEventListener &&
    MediaQueryList.prototype.addListener
  ) {
    MediaQueryList.prototype.addEventListener = function addEventListener(type, listener) {
      if (type === "change") {
        this.addListener(listener);
      }
    };
    MediaQueryList.prototype.removeEventListener = function removeEventListener(type, listener) {
      if (type === "change") {
        this.removeListener(listener);
      }
    };
  }

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
  // elements on window resize and on a slow interval; it is coarse but keeps
  // layout code that depends on it working.
  if (typeof g.ResizeObserver === "undefined") {
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
        this.interval = null;
        this.check = () => this.poll();
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
        if (this.interval === null) {
          g.addEventListener("resize", this.check);
          this.interval = setInterval(this.check, 250);
        }
        requestAnimationFrame(this.check);
      }

      unobserve(target) {
        this.sizes.delete(target);
        if (this.sizes.size === 0) {
          this.disconnect();
        }
      }

      disconnect() {
        this.sizes.clear();
        g.removeEventListener("resize", this.check);
        clearInterval(this.interval);
        this.interval = null;
      }
    };
  }

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
