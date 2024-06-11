(function () {
  if (typeof window.RegExp === "undefined") {
    return;
  }

  const originalRegExp = window.RegExp;

  window.RegExp = function (pattern, flags) {
    if (pattern instanceof originalRegExp && flags === undefined) {
      flags = pattern.flags;
    }

    if (flags) {
      if (!originalRegExp.prototype.hasOwnProperty("unicodeSets")) {
        if (flags.includes("v")) {
          flags = flags.replace("v", "u");
        }
      }

      if (!originalRegExp.prototype.hasOwnProperty("hasIndices")) {
        if (flags.includes("d")) {
          flags = flags.replace("d", "");
        }
      }
    }

    return new originalRegExp(pattern, flags);
  };
  window.RegExp.prototype = originalRegExp.prototype;
})();
