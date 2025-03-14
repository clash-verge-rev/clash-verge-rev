"use strict";

var core = require("@tauri-apps/api/core");

exports.TunStack = void 0;
(function (TunStack) {
  TunStack["Mixed"] = "Mixed";
  TunStack["Gvisor"] = "gVisor";
  TunStack["System"] = "System";
})(exports.TunStack || (exports.TunStack = {}));
exports.ClashMode = void 0;
(function (ClashMode) {
  ClashMode["Rule"] = "rule";
  ClashMode["Global"] = "global";
  ClashMode["Direct"] = "direct";
})(exports.ClashMode || (exports.ClashMode = {}));
// ======================= functions =======================
async function updateController(controller) {
  const [host, portStr] = controller.trim().split(":");
  const port = parseInt(portStr);
  await core.invoke("plugin:mihomo|update_controller", { host, port });
}
async function updateSecret(secret) {
  await core.invoke("plugin:mihomo|update_secret", { secret });
}
async function getVersion() {
  return await core.invoke("plugin:mihomo|get_version");
}
async function cleanFakeIp() {
  await core.invoke("plugin:mihomo|clean_fakeip");
}
// connections
async function getConnections() {
  return await core.invoke("plugin:mihomo|get_connections");
}
async function closeAllConnections() {
  await core.invoke("plugin:mihomo|close_all_connections");
}
async function closeConnections(connectionId) {
  await core.invoke("plugin:mihomo|close_connections", { connectionId });
}
// groups
async function getGroups() {
  return await core.invoke("plugin:mihomo|get_groups");
}
async function getGroupByName(groupName) {
  return await core.invoke("plugin:mihomo|get_group_by_name", {
    groupName,
  });
}
async function delayGroup(groupName, testUrl, timeout) {
  return await core.invoke("plugin:mihomo|delay_group", {
    groupName,
    testUrl,
    timeout,
  });
}
// providers
async function getProxiesProviders() {
  return await core.invoke("plugin:mihomo|get_proxies_providers");
}
async function getProvidersProxyByName(providerName) {
  return await core.invoke("plugin:mihomo|get_providers_proxy_by_name", {
    providerName,
  });
}
async function updateProxiesProviders(providerName) {
  await core.invoke("plugin:mihomo|update_proxies_providers", {
    providerName,
  });
}
async function healthcheckProviders(providersName) {
  await core.invoke("plugin:mihomo|healthcheck_providers", { providersName });
}
async function healthcheckProvidersProxies(
  providersName,
  proxiesName,
  testUrl,
  timeout,
) {
  await core.invoke("plugin:mihomo|healthcheck_providers_proxies", {
    providersName,
    proxiesName,
    testUrl,
    timeout,
  });
}
// proxies
async function getProxies() {
  return await core.invoke("plugin:mihomo|get_proxies");
}
async function getProxyByName(proxiesName) {
  return await core.invoke("plugin:mihomo|get_proxy_by_name", {
    proxiesName,
  });
}
async function selectNodeForProxy(proxyName, node) {
  await core.invoke("plugin:mihomo|select_node_for_proxy", {
    proxyName,
    node,
  });
}
async function delayProxyByName(proxyName, testUrl, timeout) {
  return await core.invoke("plugin:mihomo|delay_proxy_by_name", {
    proxyName,
    testUrl,
    timeout,
  });
}
// rules
async function getRules() {
  return await core.invoke("plugin:mihomo|get_rules");
}
async function getRulesProviders() {
  return await core.invoke("plugin:mihomo|get_rules_providers");
}
async function updateRulesProviders(providersName) {
  await core.invoke("plugin:mihomo|update_rules_providers", {
    providersName,
  });
}
// runtime config
async function getBaseConfig() {
  return await core.invoke("plugin:mihomo|get_base_config");
}
async function reloadConfig(force, path) {
  await core.invoke("plugin:mihomo|reload_config", {
    force,
    path,
  });
}
async function patchBaseConfig(data) {
  await core.invoke("plugin:mihomo|patch_base_config", {
    data,
  });
}
async function updateGeo() {
  await core.invoke("plugin:mihomo|update_geo");
}
async function restart() {
  await core.invoke("plugin:mihomo|restart");
}
// upgrade
async function upgradeCore() {
  await core.invoke("plugin:mihomo|upgrade_core");
}
async function upgradeUi() {
  await core.invoke("plugin:mihomo|upgrade_ui");
}
async function upgradeGeo() {
  await core.invoke("plugin:mihomo|upgrade_geo");
}
class WebSocket {
  constructor(id, listeners) {
    this.id = id;
    this.listeners = listeners;
  }
  static async connect(url) {
    const listeners = new Set();
    const onMessage = new core.Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await core
      .invoke("plugin:mihomo|connect", {
        url,
        onMessage,
      })
      .then((id) => new WebSocket(id, listeners));
  }
  static async connect_traffic() {
    const listeners = new Set();
    const onMessage = new core.Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await core
      .invoke("plugin:mihomo|ws_traffic", {
        onMessage,
      })
      .then((id) => new WebSocket(id, listeners));
  }
  static async connect_memory() {
    const listeners = new Set();
    const onMessage = new core.Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await core
      .invoke("plugin:mihomo|ws_memory", {
        onMessage,
      })
      .then((id) => new WebSocket(id, listeners));
  }
  static async connect_connections() {
    const listeners = new Set();
    const onMessage = new core.Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await core
      .invoke("plugin:mihomo|ws_connections", {
        onMessage,
      })
      .then((id) => new WebSocket(id, listeners));
  }
  static async connect_logs(level) {
    const listeners = new Set();
    const onMessage = new core.Channel();
    onMessage.onmessage = (message) => {
      listeners.forEach((l) => {
        l(message);
      });
    };
    return await core
      .invoke("plugin:mihomo|ws_logs", {
        level,
        onMessage,
      })
      .then((id) => new WebSocket(id, listeners));
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
    await core.invoke("plugin:mihomo|send", { id: this.id, message: m });
  }
  async disconnect() {
    await core.invoke("plugin:mihomo|disconnect", { id: this.id });
  }
}

exports.WebSocket = WebSocket;
exports.cleanFakeIp = cleanFakeIp;
exports.closeAllConnections = closeAllConnections;
exports.closeConnections = closeConnections;
exports.delayGroup = delayGroup;
exports.delayProxyByName = delayProxyByName;
exports.getBaseConfig = getBaseConfig;
exports.getConnections = getConnections;
exports.getGroupByName = getGroupByName;
exports.getGroups = getGroups;
exports.getProvidersProxyByName = getProvidersProxyByName;
exports.getProxies = getProxies;
exports.getProxiesProviders = getProxiesProviders;
exports.getProxyByName = getProxyByName;
exports.getRules = getRules;
exports.getRulesProviders = getRulesProviders;
exports.getVersion = getVersion;
exports.healthcheckProviders = healthcheckProviders;
exports.healthcheckProvidersProxies = healthcheckProvidersProxies;
exports.patchBaseConfig = patchBaseConfig;
exports.reloadConfig = reloadConfig;
exports.restart = restart;
exports.selectNodeForProxy = selectNodeForProxy;
exports.updateController = updateController;
exports.updateGeo = updateGeo;
exports.updateProxiesProviders = updateProxiesProviders;
exports.updateRulesProviders = updateRulesProviders;
exports.updateSecret = updateSecret;
exports.upgradeCore = upgradeCore;
exports.upgradeGeo = upgradeGeo;
exports.upgradeUi = upgradeUi;
