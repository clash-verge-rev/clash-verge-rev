import { invoke, Channel } from "@tauri-apps/api/core";

var TunStack;
(function (TunStack) {
  TunStack["Mixed"] = "Mixed";
  TunStack["Gvisor"] = "gVisor";
  TunStack["System"] = "System";
})(TunStack || (TunStack = {}));
var ClashMode;
(function (ClashMode) {
  ClashMode["Rule"] = "rule";
  ClashMode["Global"] = "global";
  ClashMode["Direct"] = "direct";
})(ClashMode || (ClashMode = {}));
// ======================= functions =======================
/**
 * 更新控制器地址
 * @param controller 控制器地址, 例如：127.0.0.1:9090
 */
async function updateController(controller) {
  const [host, portStr] = controller.trim().split(":");
  const port = parseInt(portStr);
  await invoke("plugin:mihomo|update_controller", { host, port });
}
/**
 * 更新控制器的密钥
 * @param secret 控制器的密钥
 */
async function updateSecret(secret) {
  await invoke("plugin:mihomo|update_secret", { secret });
}
/**
 * 获取Mihomo版本信息
 */
async function getVersion() {
  return await invoke("plugin:mihomo|get_version");
}
/**
 * 清除 FakeIP 的缓存
 */
async function cleanFakeIp() {
  await invoke("plugin:mihomo|clean_fakeip");
}
// connections
/**
 * 获取所有连接信息
 * @returns 所有连接信息
 */
async function getConnections() {
  return await invoke("plugin:mihomo|get_connections");
}
/**
 * 关闭所有连接
 */
async function closeAllConnections() {
  await invoke("plugin:mihomo|close_all_connections");
}
/**
 * 关闭指定连接
 * @param connectionId 连接 ID
 */
async function closeConnections(connectionId) {
  await invoke("plugin:mihomo|close_connections", { connectionId });
}
// groups
/**
 * 获取所有代理组信息
 * @returns 所有代理组信息
 */
async function getGroups() {
  return await invoke("plugin:mihomo|get_groups");
}
/**
 * 获取指定代理组信息
 * @param groupName 代理组名称
 * @returns 指定代理组信息
 */
async function getGroupByName(groupName) {
  return await invoke("plugin:mihomo|get_group_by_name", {
    groupName,
  });
}
/**
 * 获取指定代理组延迟
 *
 * 注：返回值中不包含超时的节点
 * @param groupName 代理组名称
 * @param testUrl 测试 url
 * @param timeout 超时时间（毫秒）
 * @returns 代理组里代理节点的延迟
 */
async function delayGroup(groupName, testUrl, timeout) {
  return await invoke("plugin:mihomo|delay_group", {
    groupName,
    testUrl,
    timeout,
  });
}
// providers
/**
 * 获取所有代理提供者信息
 * @returns 所有代理提供者信息
 */
async function getProxyProviders() {
  return await invoke("plugin:mihomo|get_proxy_providers");
}
/**
 * 获取指定的代理提供者信息
 * @param providerName 代理提供者名称
 * @returns 代理提供者信息
 */
async function getProxyProviderByName(providerName) {
  return await invoke("plugin:mihomo|get_proxy_provider_by_name", {
    providerName,
  });
}
/**
 * 更新代理提供者信息
 * @param providerName 代理提供者名称
 */
async function updateProxyProvider(providerName) {
  await invoke("plugin:mihomo|update_proxy_provider", {
    providerName,
  });
}
/**
 * 对指定的代理提供者进行健康检查
 * @param providerName 代理提供者名称
 */
async function healthcheckProxyProvider(providerName) {
  await invoke("plugin:mihomo|healthcheck_proxy_provider", {
    providerName,
  });
}
/**
 * 对指定代理提供者下的指定节点（非代理组）进行健康检查, 并返回新的延迟信息
 * @param providerName 代理提供者名称
 * @param proxyName 代理节点名称 (非代理组)
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟
 */
async function healthcheckNodeInProvider(
  providerName,
  proxyName,
  testUrl,
  timeout,
) {
  return await invoke("plugin:mihomo|healthcheck_node_in_provider", {
    providerName,
    proxyName,
    testUrl,
    timeout,
  });
}
// proxies
/**
 * 获取所有代理信息
 * @returns 所有代理信息
 */
async function getProxies() {
  return await invoke("plugin:mihomo|get_proxies");
}
/**
 * 获取指定代理信息
 * @param proxyName 代理名称
 * @returns 代理信息
 */
async function getProxyByName(proxyName) {
  return await invoke("plugin:mihomo|get_proxy_by_name", {
    proxiesName: proxyName,
  });
}
/**
 * 为指定代理选择节点
 *
 * 一般为指定代理组下使用指定的代理节点 【代理组/节点】
 * @param proxyName 代理组名称
 * @param node 代理节点
 */
async function selectNodeForProxy(proxyName, node) {
  await invoke("plugin:mihomo|select_node_for_proxy", {
    proxyName,
    node,
  });
}
/**
 * 指定代理组下不再使用固定的代理节点
 *
 * 一般用于自动选择的代理组（例如：URLTest 类型的代理组）下的节点
 * @param groupName 代理组名称
 */
async function unfixedProxy(groupName) {
  await invoke("plugin:mihomo|unfixed_proxy", {
    groupName,
  });
}
/**
 * 对指定代理进行延迟测试
 *
 * 一般用于代理节点的延迟测试，也可传代理组名称（只会测试代理组下选中的代理节点）
 * @param proxyName 代理节点名称
 * @param testUrl 测试 url
 * @param timeout 超时时间
 * @returns 该代理节点的延迟信息
 */
async function delayProxyByName(proxyName, testUrl, timeout) {
  return await invoke("plugin:mihomo|delay_proxy_by_name", {
    proxyName,
    testUrl,
    timeout,
  });
}
// rules
/**
 * 获取所有规则信息
 * @returns 所有规则信息
 */
async function getRules() {
  return await invoke("plugin:mihomo|get_rules");
}
/**
 * 获取所有规则提供者信息
 * @returns 所有规则提供者信息
 */
async function getRuleProviders() {
  return await invoke("plugin:mihomo|get_rule_providers");
}
/**
 * 更新规则提供者信息
 * @param providerName 规则提供者名称
 */
async function updateRuleProvider(providerName) {
  await invoke("plugin:mihomo|update_rule_provider", {
    providerName,
  });
}
// runtime config
/**
 * 获取基础配置
 * @returns 基础配置
 */
async function getBaseConfig() {
  return await invoke("plugin:mihomo|get_base_config");
}
/**
 * 重新加载配置
 * @param force 强制更新
 * @param configPath 配置文件路径
 */
async function reloadConfig(force, configPath) {
  await invoke("plugin:mihomo|reload_config", {
    force,
    configPath,
  });
}
/**
 * 更改基础配置
 * @param data 基础配置更改后的内容, 例如：{"tun": {"enabled": true}}
 */
async function patchBaseConfig(data) {
  await invoke("plugin:mihomo|patch_base_config", {
    data,
  });
}
/**
 * 更新 Geo
 */
async function updateGeo() {
  await invoke("plugin:mihomo|update_geo");
}
/**
 * 重启核心
 */
async function restart() {
  await invoke("plugin:mihomo|restart");
}
// upgrade
/**
 * 升级核心
 */
async function upgradeCore() {
  await invoke("plugin:mihomo|upgrade_core");
}
/**
 * 更新 UI
 */
async function upgradeUi() {
  await invoke("plugin:mihomo|upgrade_ui");
}
/**
 * 更新 Geo
 */
async function upgradeGeo() {
  await invoke("plugin:mihomo|upgrade_geo");
}
class WebSocket {
  constructor(id, listeners) {
    this.id = id;
    this.listeners = listeners;
  }
  /**
   * 创建一个新的 WebSocket 连接
   * @param url 要连接的 url
   * @returns WebSocket 实例
   */
  static async connect(url) {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|ws_connect", {
      url,
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的流量监控
   * @returns WebSocket 实例
   */
  static async connect_traffic() {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|ws_traffic", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的内存监控
   * @returns WebSocket 实例
   */
  static async connect_memory() {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|ws_memory", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的连接监控
   * @returns WebSocket 实例
   */
  static async connect_connections() {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|ws_connections", {
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
  /**
   * 创建一个新的 WebSocket 连接，用于 Mihomo 的日志监控
   * @returns WebSocket 实例
   */
  static async connect_logs(level) {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|ws_logs", {
      level,
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
  /**
   * 添加处理 WebSocket 连接后接受的数据的回调函数
   * @param cb 回调函数
   */
  addListener(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  /**
   * 发送消息到 WebSocket 连接
   * @param message 发送的消息
   */
  async send(message) {
    let m;
    if (typeof message === "string") {
      m = { type: "Text", data: message };
    } else if (typeof message === "object" && "type" in message) {
      m = message;
    } else if (Array.isArray(message)) {
      m = { type: "Binary", data: message };
    } else {
      throw new Error(
        "invalid `message` type, expected a `{ type: string, data: any }` object, a string or a numeric array",
      );
    }
    await invoke("plugin:mihomo|ws_send", { id: this.id, message: m });
  }
  /**
   * 关闭 WebSocket 连接
   * @param forceTimeoutSecs 强制关闭 WebSocket 连接等待的时间，单位: 秒
   */
  async disconnect(forceTimeoutSecs) {
    await invoke("plugin:mihomo|ws_disconnect", {
      id: this.id,
      forceTimeoutSecs,
    });
  }
}

export {
  ClashMode,
  TunStack,
  WebSocket,
  cleanFakeIp,
  closeAllConnections,
  closeConnections,
  delayGroup,
  delayProxyByName,
  getBaseConfig,
  getConnections,
  getGroupByName,
  getGroups,
  getProxies,
  getProxyByName,
  getProxyProviderByName,
  getProxyProviders,
  getRuleProviders,
  getRules,
  getVersion,
  healthcheckNodeInProvider,
  healthcheckProxyProvider,
  patchBaseConfig,
  reloadConfig,
  restart,
  selectNodeForProxy,
  unfixedProxy,
  updateController,
  updateGeo,
  updateProxyProvider,
  updateRuleProvider,
  updateSecret,
  upgradeCore,
  upgradeGeo,
  upgradeUi,
};
