import Sockette, { type SocketteOptions } from "sockette";

/**
 * A wrapper of Sockette that will automatically reconnect up to `maxError` before emitting an error event.
 */
export const createSockette = (
  url: string,
  opt: SocketteOptions,
  maxError = 10,
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

/**
 * 创建一个支持认证的WebSocket连接
 * 使用标准的URL参数方式添加token
 *
 * 注意：mihomo服务器对WebSocket的认证支持不佳，使用URL参数方式传递token
 */
export const createAuthSockette = (
  baseUrl: string,
  secret: string,
  opt: SocketteOptions,
  maxError = 10,
) => {
  // 确保baseUrl格式正确
  let url = baseUrl;
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = `ws://${url}`;
  }

  // 重试控制
  let reconnectAttempts = 0;
  const MAX_RECONNECT = maxError;
  let reconnectTimeout: any = null;
  let ws: WebSocket | null = null;

  // 使用URL API解析和构建URL
  try {
    const urlObj = new URL(url);

    // 添加token参数（如果有secret）
    if (secret) {
      urlObj.searchParams.delete("token");
      urlObj.searchParams.append("token", secret);
    }

    url = urlObj.toString();
    console.log(`[WebSocket] 创建连接: ${url.replace(secret || "", "***")}`);
  } catch (e) {
    console.error(`[WebSocket] URL格式错误: ${url}`, e);
    if (opt.onerror) {
      // 使用任意类型避免类型错误
      const anyOpt = opt as any;
      anyOpt.onerror(
        new ErrorEvent("error", { message: `URL格式错误: ${e}` } as any),
      );
    }
    return createDummySocket();
  }

  function connect() {
    try {
      ws = new WebSocket(url);

      ws.onopen = function (event) {
        console.log(
          `[WebSocket] 连接成功: ${url.replace(secret || "", "***")}`,
        );
        reconnectAttempts = 0; // 重置重连计数
        if (opt.onopen) {
          // 使用任意类型避免类型错误
          const anyOpt = opt as any;
          anyOpt.onopen(event);
        }
      };

      ws.onmessage = function (event) {
        if (opt.onmessage) {
          // 使用任意类型避免类型错误
          const anyOpt = opt as any;
          anyOpt.onmessage(event);
        }
      };

      ws.onerror = function (event) {
        console.error(
          `[WebSocket] 连接错误: ${url.replace(secret || "", "***")}`,
        );
        // 错误处理
        if (reconnectAttempts < MAX_RECONNECT) {
          scheduleReconnect();
        } else if (opt.onerror) {
          // 使用任意类型避免类型错误
          const anyOpt = opt as any;
          anyOpt.onerror(event);
        }
      };

      ws.onclose = function (event) {
        console.log(
          `[WebSocket] 连接关闭: ${url.replace(secret || "", "***")}, 代码: ${event.code}`,
        );

        // 如果不是正常关闭(1000, 1001)，尝试重连
        if (
          event.code !== 1000 &&
          event.code !== 1001 &&
          reconnectAttempts < MAX_RECONNECT
        ) {
          scheduleReconnect();
        } else {
          if (opt.onclose) {
            // 使用任意类型避免类型错误
            const anyOpt = opt as any;
            anyOpt.onclose(event);
          }

          // 如果已达到最大重试次数
          if (reconnectAttempts >= MAX_RECONNECT && opt.onmaximum) {
            console.error(
              `[WebSocket] 达到最大重试次数: ${url.replace(secret || "", "***")}`,
            );
            const anyOpt = opt as any;
            anyOpt.onmaximum(event);
          }
        }
      };
    } catch (error) {
      console.error(`[WebSocket] 创建连接失败:`, error);
      if (opt.onerror) {
        // 使用任意类型避免类型错误
        const anyOpt = opt as any;
        anyOpt.onerror(
          new ErrorEvent("error", { message: `创建连接失败: ${error}` } as any),
        );
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000); // 指数退避，最大10秒

    console.log(
      `[WebSocket] 计划重连 (${reconnectAttempts}/${MAX_RECONNECT}) 延迟: ${delay}ms`,
    );

    reconnectTimeout = setTimeout(() => {
      console.log(
        `[WebSocket] 尝试重连 (${reconnectAttempts}/${MAX_RECONNECT})`,
      );
      cleanup();
      connect();
    }, delay);
  }

  function cleanup() {
    if (ws) {
      // 移除所有事件监听器
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      // 如果连接仍然打开，关闭它
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        try {
          ws.close();
        } catch (e) {
          console.error("[WebSocket] 关闭连接时出错:", e);
        }
      }

      ws = null;
    }

    // 清除重连计时器
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  // 创建一个类似Sockette的接口对象
  const socketLike = {
    ws,
    close: () => {
      console.log(
        `[WebSocket] 手动关闭连接: ${url.replace(secret || "", "***")}`,
      );
      cleanup();
    },
    reconnect: () => {
      cleanup();
      connect();
    },
    json: (data: any) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
    send: (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    open: connect,
  };

  // 立即连接
  connect();

  return socketLike;
};

// 创建一个空的WebSocket对象
function createDummySocket() {
  return {
    close: () => {},
    reconnect: () => {},
    json: () => {},
    send: () => {},
    open: () => {},
  };
}
