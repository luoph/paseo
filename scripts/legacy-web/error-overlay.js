// Inlined at the top of <head> in the legacy (Safari 12) web build. Old iPads
// have no usable Web Inspector against current macOS Safari, so runtime errors
// are printed on screen instead. The build verifies this file parses as
// ES2019; keep it within that.
(function () {
  var box = null;
  var count = 0;
  var MAX_MESSAGES = 40;

  function ensureBox() {
    if (box) {
      return box;
    }
    box = document.createElement("pre");
    box.id = "paseo-legacy-errors";
    box.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:auto;margin:0;" +
      "padding:8px 8px 24px;z-index:2147483647;background:rgba(150,0,0,0.92);color:#fff;" +
      "font:11px/1.35 Menlo,monospace;white-space:pre-wrap;word-break:break-all;" +
      "-webkit-overflow-scrolling:touch";
    var close = document.createElement("div");
    close.textContent = "[tap here to hide]  " + navigator.userAgent;
    close.style.cssText = "font-weight:bold;margin-bottom:6px";
    close.addEventListener("click", function () {
      box.style.display = "none";
    });
    box.appendChild(close);
    (document.body || document.documentElement).appendChild(box);
    return box;
  }

  function stringify(value) {
    if (value && value.stack) {
      return String(value.message || "") + "\n" + String(value.stack);
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function report(message) {
    if (count >= MAX_MESSAGES) {
      return;
    }
    count += 1;
    try {
      ensureBox().appendChild(document.createTextNode(message + "\n\n"));
    } catch {
      // Nothing left to report with.
    }
  }

  var ASSET_RELOAD_KEY = "paseo-legacy-asset-reload";

  function failedAssetUrl(target) {
    if (!target || target === window || !target.tagName) {
      return "";
    }
    var url = target.src || "";
    if (!url && String(target.tagName).toUpperCase() === "LINK") {
      url = target.href || "";
    }
    return typeof url === "string" ? url : "";
  }

  // A restored document can reference hashed files this deploy already deleted.
  // Reload once so the current index.html is fetched. The same missing URL does
  // not reload again, or a real 404 would spin forever.
  function reloadForMissingAsset(url) {
    if (url.indexOf("/_expo/static/") === -1) {
      return;
    }
    try {
      if (window.sessionStorage.getItem(ASSET_RELOAD_KEY) === url) {
        return;
      }
      window.sessionStorage.setItem(ASSET_RELOAD_KEY, url);
    } catch {
      return;
    }
    window.location.reload(true);
  }

  window.addEventListener(
    "error",
    function (event) {
      var assetUrl = failedAssetUrl(event.target);
      if (assetUrl) {
        report("[load error] " + assetUrl);
        reloadForMissingAsset(assetUrl);
        return;
      }
      report(
        "[error] " +
          (event.message || "") +
          " @ " +
          (event.filename || "") +
          ":" +
          (event.lineno || "") +
          ":" +
          (event.colno || "") +
          (event.error ? "\n" + stringify(event.error) : ""),
      );
    },
    true,
  );

  window.addEventListener("unhandledrejection", function (event) {
    report("[unhandledrejection] " + stringify(event.reason));
  });

  var originalConsoleError = console.error;
  console.error = function () {
    // Once the box is full, skip stringifying: React logs large objects, and a
    // render loop that keeps logging would otherwise churn memory for nothing.
    if (count >= MAX_MESSAGES) {
      return originalConsoleError.apply(console, arguments);
    }
    var parts = [];
    for (var i = 0; i < arguments.length; i += 1) {
      parts.push(stringify(arguments[i]));
    }
    report("[console.error] " + parts.join(" "));
    return originalConsoleError.apply(console, arguments);
  };

  window.__paseoLegacyReport = report;
})();
