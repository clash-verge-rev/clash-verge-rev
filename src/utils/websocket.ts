import Sockette, { type SocketteOptions } from "sockette";

/**
 * A wrapper of Sockette that will automatically reconnect up to `maxError` before emitting an error event.
 */
export const createSockette = (
  url: string,
  opt: SocketteOptions,
  maxError = 10
) => {
  let remainRetryCount = maxError;

  return new Sockette(url, {
    ...opt,
    // Sockette has a built-in reconnect when ECONNREFUSED feature
    // Use maxError if opt.maxAttempts is not specified
    maxAttempts: opt.maxAttempts ?? maxError,
    onmessage(this: Sockette, ev) {
      remainRetryCount = maxError; // reset counter
      opt.onmessage?.call(this, ev);
    },
    onerror(this: Sockette, ev) {
      remainRetryCount -= 1;

      if (remainRetryCount >= 0) {
        if (this instanceof Sockette) {
          this.close();
          this.reconnect();
        }
      } else {
        opt.onerror?.call(this, ev);
      }
    },
    onmaximum(this: Sockette, ev) {
      opt.onmaximum?.call(this, ev);
      // onmaximum will be fired when Sockette reaches built-in reconnect limit,
      // We will also set remainRetryCount to 0 to prevent further reconnect.
      remainRetryCount = 0;
    },
  });
};
