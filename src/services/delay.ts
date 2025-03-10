import { cmdGetProxyDelay } from "./cmds";

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

class DelayManager {
  private cache = new Map<string, [number, number]>();
  private urlMap = new Map<string, string>();

  // 每个item的监听
  private listenerMap = new Map<string, (time: number) => void>();

  // 每个分组的监听
  private groupListenerMap = new Map<string, () => void>();

  setUrl(group: string, url: string) {
    console.log(`[DelayManager] 设置测试URL，组: ${group}, URL: ${url}`);
    this.urlMap.set(group, url);
  }

  getUrl(group: string) {
    const url = this.urlMap.get(group);
    console.log(
      `[DelayManager] 获取测试URL，组: ${group}, URL: ${url || "未设置"}`,
    );
    // 如果未设置URL，返回默认URL
    return url || "http://cp.cloudflare.com/generate_204";
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
    console.log(
      `[DelayManager] 设置延迟，代理: ${name}, 组: ${group}, 延迟: ${delay}`,
    );

    this.cache.set(key, [delay, Date.now()]);
    const listener = this.listenerMap.get(key);
    if (listener) listener(delay);
  }

  getDelay(name: string, group: string) {
    const key = hashKey(name, group);
    const val = this.cache.get(key);
    if (!val) return -1;

    // 缓存30分钟
    if (Date.now() - val[1] > 30 * 60 * 1000) {
      return -1;
    }
    return val[0];
  }

  /// 暂时修复provider的节点延迟排序的问题
  getDelayFix(proxy: IProxyItem, group: string) {
    if (!proxy.provider) {
      const delay = this.getDelay(proxy.name, group);
      if (delay >= 0 || delay === -2) return delay;
    }

    if (proxy.history.length > 0) {
      // 0ms以error显示
      return proxy.history[proxy.history.length - 1].delay || 1e6;
    }
    return -1;
  }

  async checkDelay(name: string, group: string, timeout: number) {
    console.log(
      `[DelayManager] 开始测试延迟，代理: ${name}, 组: ${group}, 超时: ${timeout}ms`,
    );

    // 先将状态设置为测试中
    this.setDelay(name, group, -2);

    let delay = -1;

    try {
      const url = this.getUrl(group);
      console.log(`[DelayManager] 调用API测试延迟，代理: ${name}, URL: ${url}`);

      // 记录开始时间，用于计算实际延迟
      const startTime = Date.now();

      // 设置超时处理
      const timeoutPromise = new Promise<{ delay: number }>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), timeout);
      });

      // 使用Promise.race来实现超时控制
      const result = await Promise.race([
        cmdGetProxyDelay(name, timeout, url),
        timeoutPromise,
      ]);

      // 确保至少显示500ms的加载动画
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsedTime));
      }

      // 检查延迟结果是否为undefined
      if (result && typeof result.delay === "number") {
        delay = result.delay;
        console.log(
          `[DelayManager] 延迟测试完成，代理: ${name}, 结果: ${delay}ms`,
        );
      } else {
        console.error(
          `[DelayManager] 延迟测试返回无效结果，代理: ${name}, 结果:`,
          result,
        );
        delay = 1e6; // 错误情况
      }
    } catch (error) {
      // 确保至少显示500ms的加载动画
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.error(`[DelayManager] 延迟测试出错，代理: ${name}`, error);
      if (error instanceof Error && error.message === "Timeout") {
        console.log(`[DelayManager] 延迟测试超时，代理: ${name}`);
      }
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
    console.log(
      `[DelayManager] 批量测试延迟开始，组: ${group}, 数量: ${nameList.length}, 并发数: ${concurrency}`,
    );
    const names = nameList.filter(Boolean);
    // 设置正在延迟测试中
    names.forEach((name) => this.setDelay(name, group, -2));

    let index = 0;
    const startTime = Date.now();
    const listener = this.groupListenerMap.get(group);

    const help = async (): Promise<void> => {
      const currName = names[index++];
      if (!currName) return;

      try {
        // 确保API调用前状态为测试中
        this.setDelay(currName, group, -2);

        // 添加一些随机延迟，避免所有请求同时发出和返回
        if (index > 1) {
          // 第一个不延迟，保持响应性
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 200),
          );
        }

        await this.checkDelay(currName, group, timeout);
        if (listener) listener();
      } catch (error) {
        console.error(
          `[DelayManager] 批量测试单个代理出错，代理: ${currName}`,
          error,
        );
        // 设置为错误状态
        this.setDelay(currName, group, 1e6);
      }

      return help();
    };

    // 限制并发数，避免发送太多请求
    const actualConcurrency = Math.min(concurrency, names.length, 10);
    console.log(`[DelayManager] 实际并发数: ${actualConcurrency}`);

    const promiseList: Promise<void>[] = [];
    for (let i = 0; i < actualConcurrency; i++) {
      promiseList.push(help());
    }

    await Promise.all(promiseList);
    const totalTime = Date.now() - startTime;
    console.log(
      `[DelayManager] 批量测试延迟完成，组: ${group}, 总耗时: ${totalTime}ms`,
    );
  }

  formatDelay(delay: number, timeout = 10000) {
    if (delay === -1) return "-";
    if (delay === -2) return "testing";
    if (delay >= timeout) return "timeout";
    return `${delay}`;
  }

  formatDelayColor(delay: number, timeout = 10000) {
    if (delay < 0) return "";
    if (delay >= timeout) return "error.main";
    if (delay >= 10000) return "error.main";
    if (delay >= 400) return "warning.main";
    if (delay >= 250) return "primary.main";
    return "success.main";
  }
}

export default new DelayManager();
