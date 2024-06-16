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
    onmessage(this: Sockette, ev) {
      remainRetryCount = maxError; // reset counter
      opt.onmessage?.call(this, ev);
    },
    onerror(this: Sockette, ev) {
      remainRetryCount -= 1;

      if (remainRetryCount >= 0) {
        this.close();
        this.reconnect();
      } else {
        opt.onerror?.call(this, ev);
      }
    },
  });
};
