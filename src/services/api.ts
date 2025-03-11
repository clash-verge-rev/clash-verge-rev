import {
  getProxies,
  getProxiesProviders,
  getRulesProviders,
} from "tauri-plugin-mihomo-api";

/// Get the Proxy information
export const calcuProxies = async () => {
  const proxyRecord = (await getProxies()).proxies;
  const providerRecord = await calcuProxyProviders();
  // provider name map
  const providerMap = Object.fromEntries(
    Object.entries(providerRecord).flatMap(([provider, item]) =>
      item.proxies.map((p) => [p.name, { ...p, provider }]),
    ),
  );

  // compatible with proxy-providers
  const generateItem = (name: string) => {
    if (proxyRecord[name]) return proxyRecord[name];
    if (providerMap[name]) return providerMap[name];
    return {
      name,
      type: "unknown",
      udp: false,
      xudp: false,
      tfo: false,
      history: [],
    };
  };

  const { GLOBAL: global, DIRECT: direct, REJECT: reject } = proxyRecord;

  let groups: IProxyGroupItem[] = Object.values(proxyRecord).reduce<
    IProxyGroupItem[]
  >((acc, each) => {
    if (each.name !== "GLOBAL" && each.all) {
      acc.push({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      });
    }

    return acc;
  }, []);

  if (global?.all) {
    let globalGroups: IProxyGroupItem[] = global.all.reduce<IProxyGroupItem[]>(
      (acc, name) => {
        if (proxyRecord[name]?.all) {
          acc.push({
            ...proxyRecord[name],
            all: proxyRecord[name].all!.map((item) => generateItem(item)),
          });
        }
        return acc;
      },
      [],
    );

    let globalNames = new Set(globalGroups.map((each) => each.name));
    groups = groups
      .filter((group) => {
        return !globalNames.has(group.name);
      })
      .concat(globalGroups);
  }

  const proxies = [direct, reject].concat(
    Object.values(proxyRecord).filter(
      (p) => !p.all?.length && p.name !== "DIRECT" && p.name !== "REJECT",
    ),
  );

  const _global: IProxyGroupItem = {
    ...global,
    all: global?.all?.map((item) => generateItem(item)) || [],
  };

  const res = {
    global: _global,
    direct,
    groups,
    records: proxyRecord,
    proxies,
  };
  return res;
};

// get proxy providers
export const calcuProxyProviders = async () => {
  const providers = await getProxiesProviders();
  return Object.fromEntries(
    Object.entries(providers.providers)
      .sort()
      .filter(([key, item]) => {
        const type = item.vehicleType.toLowerCase();
        return type === "http" || type === "file";
      }),
  );
};

export const calcuRuleProviders = async () => {
  const providers = await getRulesProviders();
  return Object.fromEntries(
    Object.entries(providers.providers)
      .sort()
      .filter(([key, item]) => {
        const type = item.vehicleType.toLowerCase();
        return type === "http" || type === "file";
      }),
  );
};
