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
}

export default new DelayManager();
