import { getProxyDelay } from "./api";

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

class DelayManager {
  private cache = new Map<string, [number, number]>();

  setDelay(name: string, group: string, delay: number) {
    this.cache.set(hashKey(name, group), [Date.now(), delay]);
  }

  getDelay(name: string, group: string) {
    if (!name) return -1;

    const result = this.cache.get(hashKey(name, group));
    if (result && Date.now() - result[0] <= 18e5) {
      return result[1];
    }
    return -1;
  }

  async checkDelay(name: string, group: string) {
    let delay = -1;

    try {
      const result = await getProxyDelay(name);
      delay = result.delay;
    } catch {
      delay = 1e6; // error
    }

    this.setDelay(name, group, delay);
    return delay;
  }

  async checkListDelay(
    options: {
      names: readonly string[];
      groupName: string;
      skipNum: number;
      maxTimeout: number;
    },
    callback: Function
  ) {
    let names = [...options.names];
    const { groupName, skipNum, maxTimeout } = options;

    while (names.length) {
      const list = names.slice(0, skipNum);
      names = names.slice(skipNum);

      let called = false;
      setTimeout(() => {
        if (!called) {
          called = true;
          callback();
        }
      }, maxTimeout);

      await Promise.all(list.map((n) => this.checkDelay(n, groupName)));

      if (!called) {
        called = true;
        callback();
      }
    }
  }
}

export default new DelayManager();
