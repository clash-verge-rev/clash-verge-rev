import { getProxyDelay } from "./api";

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

class DelayManager {
  private cache = new Map<string, [number, number]>();
  private urlMap = new Map<string, string>();

  // 每个item的监听
  private listenerMap = new Map<string, (time: number) => void>();

  // 每个分组的监听
  private groupListenerMap = new Map<string, () => void>();

  setUrl(group: string, url: string) {
    this.urlMap.set(group, url);
  }

  getUrl(group: string) {
    return this.urlMap.get(group);
  }

  setListener(name: string, group: string, listener: (time: number) => void) {
    const key = hashKey(name, group);
    this.listenerMap.set(key, listener);
  }

  removeListener(name: string, group: string) {
    const key = hashKey(name, group);
    this.listenerMap.delete(key);
  }

  setGroupListener(group: string, listener: () => void) {
    this.groupListenerMap.set(group, listener);
  }

  removeGroupListener(group: string) {
    this.groupListenerMap.delete(group);
  }

  setDelay(name: string, group: string, delay: number) {
    const key = hashKey(name, group);
    this.cache.set(key, [Date.now(), delay]);
    this.listenerMap.get(key)?.(delay);
    this.groupListenerMap.get(group)?.();
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
      const url = this.getUrl(group);
      const result = await getProxyDelay(name, url);
      delay = result.delay;
    } catch {
      delay = 1e6; // error
    }

    this.setDelay(name, group, delay);
    return delay;
  }

  async checkListDelay(
    nameList: readonly string[],
    groupName: string,
    concurrency: number
  ) {
    const names = [...nameList];

    let total = names.length;
    let current = 0;

    // 设置正在延迟测试中
    names.forEach((name) => this.setDelay(name, groupName, -2));

    return new Promise((resolve) => {
      const help = async (): Promise<void> => {
        if (current >= concurrency) return;

        const task = names.shift();
        if (!task) return;

        current += 1;
        await this.checkDelay(task, groupName);
        current -= 1;
        total -= 1;

        if (total <= 0) resolve(null);
        else return help();
      };

      for (let i = 0; i < concurrency; ++i) help();
    });
  }
}

export default new DelayManager();
