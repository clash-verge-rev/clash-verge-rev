import { getProxyDelay } from "./api";

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

class DelayManager {
  private cache = new Map<string, [number, number]>();
  private urlMap = new Map<string, string>();

  setUrl(group: string, url: string) {
    this.urlMap.set(group, url);
  }

  getUrl(group: string) {
    return this.urlMap.get(group);
  }

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
    options: {
      names: readonly string[];
      groupName: string;
      skipNum: number;
    },
    callback: Function
  ) {
    const { groupName, skipNum } = options;

    const names = [...options.names];
    const total = names.length;

    let count = 0;
    let current = 0;

    // 设置正在延迟测试中
    names.forEach((name) => this.setDelay(name, groupName, -2));

    return new Promise((resolve) => {
      const help = async (): Promise<void> => {
        if (current >= skipNum) return;

        const task = names.shift();
        if (!task) return;

        current += 1;
        await this.checkDelay(task, groupName);
        current -= 1;

        if (count++ % skipNum === 0 || count === total) callback();
        if (count === total) resolve(null);

        return help();
      };

      for (let i = 0; i < skipNum; ++i) help();
    });
  }
}

export default new DelayManager();
