(function (global) {
  if (typeof global === "object" && global) {
    if (typeof global.RegExp !== "undefined") {
      const OriginalRegExp = global.RegExp;
      const CustomRegExp = function (pattern, flags) {
        if (typeof pattern === "string" && typeof flags === "string") {
          flags = flags;
        } else if (pattern instanceof OriginalRegExp && flags === undefined) {
          flags = pattern.flags;
        }

        if (flags) {
          if (!global.RegExp.prototype.hasOwnProperty("unicodeSets")) {
            if (flags.includes("v")) {
              flags = flags.replace("v", "u");
            }
          }

          if (!global.RegExp.prototype.hasOwnProperty("hasIndices")) {
            if (flags.includes("d")) {
              flags = flags.replace("d", "");
            }
          }
        }

        return new OriginalRegExp(pattern, flags);
      };

      CustomRegExp.prototype = OriginalRegExp.prototype;

      global.RegExp = CustomRegExp;
    }
  }
})(
  (function () {
    switch (true) {
      case typeof globalThis === "object" && !!globalThis:
        return globalThis;
      case typeof self === "object" && !!self:
        return self;
      case typeof window === "object" && !!window:
        return window;
      case typeof global === "object" && !!global:
        return global;
      case typeof Function === "function":
        return Function("return this")();
    }
    return null;
  })()
);
