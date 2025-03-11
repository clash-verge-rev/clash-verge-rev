import { delayProxyByName } from "tauri-plugin-mihomo-api";

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

  /// 暂时修复provider的节点延迟排序的问题
  getDelayFix(proxy: IProxyItem, group: string) {
    if (!proxy.provider) {
      const delay = this.getDelay(proxy.name, group);
      if (delay >= 0 || delay === -2) return delay;
    }

    if (proxy.history.length > 0) {
      return proxy.history[proxy.history.length - 1].delay;
    }
    return -1;
  }

  async checkDelay(name: string, group: string, timeout: number) {
    let delay = -1;

    try {
      const url = this.getUrl(group);
      const result = await delayProxyByName(
        name,
        url || "https://www.gstatic.com/generate_204",
        timeout,
      );
      if (result.delay) {
        delay = result.delay;
      } else if (result.message) {
        delay = 0; // timeout
      }
    } catch {
      delay = 1e6; // error
    }

    this.setDelay(name, group, delay);
    return delay;
  }

  async checkListDelay(
    nameList: string[],
    group: string,
    timeout: number,
    concurrency = 36,
  ) {
    const names = nameList.filter(Boolean);
    // 设置正在延迟测试中
    names.forEach((name) => this.setDelay(name, group, -2));

    let total = names.length;
    let current = 0;

    return new Promise((resolve) => {
      const help = async (): Promise<void> => {
        if (current >= concurrency) return;
        const task = names.shift();
        if (!task) return;
        current += 1;
        await this.checkDelay(task, group, timeout);
        current -= 1;
        total -= 1;
        if (total <= 0) resolve(null);
        else return help();
      };
      for (let i = 0; i < concurrency; ++i) help();
    });
  }

  formatDelay(delay: number, timeout = 5000) {
    if (delay < 0) return "Error";
    if (delay == 0) return "Timeout";
    if (delay > 1e5) return "Error";
    if (delay >= timeout) return "Timeout"; // 5s
    return `${delay}`;
  }

  formatDelayColor(delay: number, timeout = 5000) {
    if (delay >= timeout) return "error.main";
    if (delay <= 0) return "error.main";
    if (delay > 500) return "warning.main";
    return "success.main";
  }
}

export default new DelayManager();
