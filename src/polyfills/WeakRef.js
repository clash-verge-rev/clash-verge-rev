(function (global) {
  if (typeof global === "object" && global) {
    if (typeof global["WeakRef"] === "undefined") {
      global.WeakRef = (function (wm) {
        function WeakRef(target) {
          wm.set(this, target);
        }

        WeakRef.prototype.deref = function () {
          return wm.get(this);
        };

        return WeakRef;
      })(new WeakMap());
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
