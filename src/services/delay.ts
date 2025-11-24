import { delayProxyByName, ProxyDelay } from "tauri-plugin-mihomo-api";

import { debugLog } from "@/utils/debug";

const hashKey = (name: string, group: string) => `${group ?? ""}::${name}`;

export interface DelayUpdate {
  delay: number;
  elapsed?: number;
  updatedAt: number;
}

const CACHE_TTL = 30 * 60 * 1000;

class DelayManager {
  private cache = new Map<string, DelayUpdate>();
  private urlMap = new Map<string, string>();

  // 每个节点的监听
  private listenerMap = new Map<string, (update: DelayUpdate) => void>();

  // 每个分组的监听
  private groupListenerMap = new Map<string, () => void>();

  private pendingItemUpdates = new Map<string, DelayUpdate[]>();
  private pendingGroupUpdates = new Set<string>();
  private itemFlushScheduled = false;
  private groupFlushScheduled = false;

  private scheduleItemFlush() {
    if (this.itemFlushScheduled) return;
    this.itemFlushScheduled = true;

    const run = () => {
      this.itemFlushScheduled = false;
      const updates = this.pendingItemUpdates;
      this.pendingItemUpdates = new Map();

      updates.forEach((queue, key) => {
        const listener = this.listenerMap.get(key);
        if (!listener) return;

        queue.forEach((update) => {
          try {
            listener(update);
          } catch (error) {
            console.error(
              `[DelayManager] 通知节点延迟监听器失败: ${key}`,
              error,
            );
          }
        });
      });
    };

    if (typeof window !== "undefined") {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(run);
        return;
      }
      if (typeof window.setTimeout === "function") {
        window.setTimeout(run, 0);
        return;
      }
    }

    Promise.resolve().then(run);
  }

  private scheduleGroupFlush() {
    if (this.groupFlushScheduled) return;
    this.groupFlushScheduled = true;

    const run = () => {
      this.groupFlushScheduled = false;
      const groups = this.pendingGroupUpdates;
      this.pendingGroupUpdates = new Set();

      groups.forEach((group) => {
        const listener = this.groupListenerMap.get(group);
        if (!listener) return;
        try {
          listener();
        } catch (error) {
          console.error(
            `[DelayManager] 通知分组延迟监听器失败: ${group}`,
            error,
          );
        }
      });
    };

    if (typeof window !== "undefined") {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(run);
        return;
      }
      if (typeof window.setTimeout === "function") {
        window.setTimeout(run, 0);
        return;
      }
    }

    Promise.resolve().then(run);
  }

  private queueGroupNotification(group: string) {
    this.pendingGroupUpdates.add(group);
    this.scheduleGroupFlush();
  }

  setUrl(group: string, url: string) {
    debugLog(`[DelayManager] 设置测试URL，组: ${group}, URL: ${url}`);
    this.urlMap.set(group, url);
  }

  getUrl(group: string) {
    const url = this.urlMap.get(group);
    debugLog(
      `[DelayManager] 获取测试URL，组: ${group}, URL: ${url || "未设置"}`,
    );
    // 如果未设置URL，返回默认URL
    return url || "https://cp.cloudflare.com/generate_204";
  }

  setListener(
    name: string,
    group: string,
    listener: (update: DelayUpdate) => void,
  ) {
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

  setDelay(
    name: string,
    group: string,
    delay: number,
    meta?: { elapsed?: number },
  ): DelayUpdate {
    const key = hashKey(name, group);
    debugLog(
      `[DelayManager] 设置延迟，代理: ${name}, 组: ${group}, 延迟: ${delay}`,
    );
    const update: DelayUpdate = {
      delay,
      elapsed: meta?.elapsed,
      updatedAt: Date.now(),
    };

    this.cache.set(key, update);

    const queue = this.pendingItemUpdates.get(key);
    if (queue) {
      queue.push(update);
    } else {
      this.pendingItemUpdates.set(key, [update]);
    }
    this.scheduleItemFlush();

    return update;
  }

  getDelayUpdate(name: string, group: string) {
    const key = hashKey(name, group);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.updatedAt > CACHE_TTL) {
      this.cache.delete(key);
      return undefined;
    }

    return { ...entry };
  }

  getDelay(name: string, group: string) {
    const update = this.getDelayUpdate(name, group);
    return update ? update.delay : -1;
  }

  /// 暂时修复provider的节点延迟排序的问题
  getDelayFix(proxy: IProxyItem, group: string) {
    if (!proxy.provider) {
      const update = this.getDelayUpdate(proxy.name, group);
      if (update && (update.delay >= 0 || update.delay === -2)) {
        return update.delay;
      }
    }

    // 添加 history 属性的安全检查
    if (proxy.history && proxy.history.length > 0) {
      // 0ms以error显示
      return proxy.history[proxy.history.length - 1].delay || 1e6;
    }
    return -1;
  }

  async checkDelay(
    name: string,
    group: string,
    timeout: number,
  ): Promise<DelayUpdate> {
    debugLog(
      `[DelayManager] 开始测试延迟，代理: ${name}, 组: ${group}, 超时: ${timeout}ms`,
    );

    // 先将状态设置为测试中
    this.setDelay(name, group, -2);

    let delay = -1;
    let elapsed = 0;

    const startTime = Date.now();

    try {
      const url = this.getUrl(group);
      debugLog(`[DelayManager] 调用API测试延迟，代理: ${name}, URL: ${url}`);

      // 设置超时处理, delay = 0 为超时
      const timeoutPromise = new Promise<ProxyDelay>((resolve) => {
        setTimeout(() => resolve({ delay: 0 }), timeout);
      });

      // 使用Promise.race来实现超时控制
      const result = await Promise.race([
        delayProxyByName(name, url, timeout),
        timeoutPromise,
      ]);

      // 确保至少显示500ms的加载动画
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsedTime));
      }

      delay = result.delay;
      elapsed = elapsedTime;
      debugLog(`[DelayManager] 延迟测试完成，代理: ${name}, 结果: ${delay}ms`);
    } catch (error) {
      // 确保至少显示500ms的加载动画
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.error(`[DelayManager] 延迟测试出错，代理: ${name}`, error);
      delay = 1e6; // error
      elapsed = Date.now() - startTime;
    }

    return this.setDelay(name, group, delay, { elapsed });
  }

  async checkListDelay(
    nameList: string[],
    group: string,
    timeout: number,
    concurrency = 36,
  ) {
    debugLog(
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
        if (listener) {
          this.queueGroupNotification(group);
        }
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
    debugLog(`[DelayManager] 实际并发数: ${actualConcurrency}`);

    const promiseList: Promise<void>[] = [];
    for (let i = 0; i < actualConcurrency; i++) {
      promiseList.push(help());
    }

    await Promise.all(promiseList);
    const totalTime = Date.now() - startTime;
    debugLog(
      `[DelayManager] 批量测试延迟完成，组: ${group}, 总耗时: ${totalTime}ms`,
    );
  }

  formatDelay(delay: number, timeout = 10000) {
    if (delay === -1) return "-";
    if (delay === -2) return "testing";
    if (delay === 0 || (delay >= timeout && delay <= 1e5)) return "Timeout";
    if (delay > 1e5) return "Error";
    return `${delay}`;
  }

  formatDelayColor(delay: number, timeout = 10000) {
    if (delay < 0) return "";
    if (delay === 0 || delay >= timeout) return "error.main";
    if (delay >= 10000) return "error.main";
    if (delay >= 400) return "warning.main";
    if (delay >= 250) return "primary.main";
    return "success.main";
  }
}

export default new DelayManager();
