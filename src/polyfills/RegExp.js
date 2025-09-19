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
      if (
        !Object.prototype.hasOwnProperty.call(
          originalRegExp.prototype,
          "unicodeSets",
        )
      ) {
        if (flags.includes("v")) {
          flags = flags.replace("v", "u");
        }
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          originalRegExp.prototype,
          "hasIndices",
        )
      ) {
        if (flags.includes("d")) {
          flags = flags.replace("d", "");
        }
      }
    }

    return new originalRegExp(pattern, flags);
  };
  window.RegExp.prototype = originalRegExp.prototype;
})();
