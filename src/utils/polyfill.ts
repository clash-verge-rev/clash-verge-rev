// matchMedia polyfill for macOS 10.15
if (
  window.MediaQueryList &&
  !window.MediaQueryList.prototype.addEventListener
) {
  window.MediaQueryList.prototype.addEventListener = function (
    name: string,
    callback: any
  ) {
    this.addListener(callback);
  };

  window.MediaQueryList.prototype.removeEventListener = function (
    name: string,
    callback: any
  ) {
    this.removeListener(callback);
  };
}

export {};
