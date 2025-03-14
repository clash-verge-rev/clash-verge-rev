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
async function updateController(controller) {
  const [host, portStr] = controller.trim().split(":");
  const port = parseInt(portStr);
  await invoke("plugin:mihomo|update_controller", { host, port });
}
async function updateSecret(secret) {
  await invoke("plugin:mihomo|update_secret", { secret });
}
async function getVersion() {
  return await invoke("plugin:mihomo|get_version");
}
async function cleanFakeIp() {
  await invoke("plugin:mihomo|clean_fakeip");
}
// connections
async function getConnections() {
  return await invoke("plugin:mihomo|get_connections");
}
async function closeAllConnections() {
  await invoke("plugin:mihomo|close_all_connections");
}
async function closeConnections(connectionId) {
  await invoke("plugin:mihomo|close_connections", { connectionId });
}
// groups
async function getGroups() {
  return await invoke("plugin:mihomo|get_groups");
}
async function getGroupByName(groupName) {
  return await invoke("plugin:mihomo|get_group_by_name", {
    groupName,
  });
}
async function delayGroup(groupName, testUrl, timeout) {
  return await invoke("plugin:mihomo|delay_group", {
    groupName,
    testUrl,
    timeout,
  });
}
// providers
async function getProxiesProviders() {
  return await invoke("plugin:mihomo|get_proxies_providers");
}
async function getProvidersProxyByName(providerName) {
  return await invoke("plugin:mihomo|get_providers_proxy_by_name", {
    providerName,
  });
}
async function updateProxiesProviders(providerName) {
  await invoke("plugin:mihomo|update_proxies_providers", {
    providerName,
  });
}
async function healthcheckProviders(providersName) {
  await invoke("plugin:mihomo|healthcheck_providers", { providersName });
}
async function healthcheckProvidersProxies(
  providersName,
  proxiesName,
  testUrl,
  timeout,
) {
  await invoke("plugin:mihomo|healthcheck_providers_proxies", {
    providersName,
    proxiesName,
    testUrl,
    timeout,
  });
}
// proxies
async function getProxies() {
  return await invoke("plugin:mihomo|get_proxies");
}
async function getProxyByName(proxiesName) {
  return await invoke("plugin:mihomo|get_proxy_by_name", {
    proxiesName,
  });
}
async function selectNodeForProxy(proxyName, node) {
  await invoke("plugin:mihomo|select_node_for_proxy", {
    proxyName,
    node,
  });
}
async function delayProxyByName(proxyName, testUrl, timeout) {
  return await invoke("plugin:mihomo|delay_proxy_by_name", {
    proxyName,
    testUrl,
    timeout,
  });
}
// rules
async function getRules() {
  return await invoke("plugin:mihomo|get_rules");
}
async function getRulesProviders() {
  return await invoke("plugin:mihomo|get_rules_providers");
}
async function updateRulesProviders(providersName) {
  await invoke("plugin:mihomo|update_rules_providers", {
    providersName,
  });
}
// runtime config
async function getBaseConfig() {
  return await invoke("plugin:mihomo|get_base_config");
}
async function reloadConfig(force, path) {
  await invoke("plugin:mihomo|reload_config", {
    force,
    path,
  });
}
async function patchBaseConfig(data) {
  await invoke("plugin:mihomo|patch_base_config", {
    data,
  });
}
async function updateGeo() {
  await invoke("plugin:mihomo|update_geo");
}
async function restart() {
  await invoke("plugin:mihomo|restart");
}
// upgrade
async function upgradeCore() {
  await invoke("plugin:mihomo|upgrade_core");
}
async function upgradeUi() {
  await invoke("plugin:mihomo|upgrade_ui");
}
async function upgradeGeo() {
  await invoke("plugin:mihomo|upgrade_geo");
}
class WebSocket {
  constructor(id, listeners) {
    this.id = id;
    this.listeners = listeners;
  }
  static async connect(url) {
    const listeners = new Set();
    const onMessage = new Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await invoke("plugin:mihomo|connect", {
      url,
      onMessage,
    }).then((id) => new WebSocket(id, listeners));
  }
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
  addListener(cb) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
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
    await invoke("plugin:mihomo|send", { id: this.id, message: m });
  }
  async disconnect() {
    await invoke("plugin:mihomo|disconnect", { id: this.id });
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
  getProvidersProxyByName,
  getProxies,
  getProxiesProviders,
  getProxyByName,
  getRules,
  getRulesProviders,
  getVersion,
  healthcheckProviders,
  healthcheckProvidersProxies,
  patchBaseConfig,
  reloadConfig,
  restart,
  selectNodeForProxy,
  updateController,
  updateGeo,
  updateProxiesProviders,
  updateRulesProviders,
  updateSecret,
  upgradeCore,
  upgradeGeo,
  upgradeUi,
};
