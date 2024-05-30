(function () {
  if (typeof window.WeakRef !== "undefined") {
    return;
  }

  window.WeakRef = (function (weakMap) {
    function WeakRef(target) {
      weakMap.set(this, target);
    }
    WeakRef.prototype.deref = function () {
      return weakMap.get(this);
    };

    return WeakRef;
  })(new WeakMap());
})();
