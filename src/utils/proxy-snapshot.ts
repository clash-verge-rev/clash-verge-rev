import yaml from "js-yaml";

const createProxyItem = (
  name: string,
  partial: Partial<IProxyItem> = {},
): IProxyItem => ({
  name,
  type: partial.type ?? "unknown",
  udp: partial.udp ?? false,
  xudp: partial.xudp ?? false,
  tfo: partial.tfo ?? false,
  mptcp: partial.mptcp ?? false,
  smux: partial.smux ?? false,
  history: [],
  provider: partial.provider,
  testUrl: partial.testUrl,
});

const createGroupItem = (
  name: string,
  all: IProxyItem[],
  partial: Partial<IProxyGroupItem> = {},
): IProxyGroupItem => {
  const rest = { ...partial } as Partial<IProxyItem>;
  delete (rest as Partial<IProxyGroupItem>).all;
  const base = createProxyItem(name, rest);
  return {
    ...base,
    all,
    now: partial.now ?? base.now,
  };
};

const ensureProxyItem = (
  map: Map<string, IProxyItem>,
  name: string,
  source?: Partial<IProxyItem>,
) => {
  const key = String(name);
  if (map.has(key)) return map.get(key)!;
  const item = createProxyItem(key, source);
  map.set(key, item);
  return item;
};

const parseProxyEntry = (entry: any): IProxyItem | null => {
  if (!entry || typeof entry !== "object") return null;
  const name = entry.name || entry.uid || entry.id;
  if (!name) return null;
  return createProxyItem(String(name), {
    type: entry.type ? String(entry.type) : undefined,
    udp: Boolean(entry.udp),
    xudp: Boolean(entry.xudp),
    tfo: Boolean(entry.tfo),
    mptcp: Boolean(entry.mptcp),
    smux: Boolean(entry.smux),
    testUrl: entry.test_url || entry.testUrl,
  });
};

const parseProxyGroup = (
  entry: any,
  proxyMap: Map<string, IProxyItem>,
): IProxyGroupItem | null => {
  if (!entry || typeof entry !== "object") return null;
  const name = entry.name;
  if (!name) return null;

  const rawList: unknown[] = Array.isArray(entry.proxies)
    ? entry.proxies
    : Array.isArray(entry.use)
      ? entry.use
      : [];

  const uniqueNames = Array.from(
    new Set(
      rawList
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim()),
    ),
  );

  const all = uniqueNames.map((proxyName) =>
    ensureProxyItem(proxyMap, proxyName),
  );

  return createGroupItem(String(name), all, {
    type: entry.type ? String(entry.type) : "Selector",
    provider: entry.provider,
    testUrl: entry.testUrl || entry.test_url,
    now: typeof entry.now === "string" ? entry.now : undefined,
  });
};

const mapRecords = (
  proxies: Map<string, IProxyItem>,
  groups: IProxyGroupItem[],
  extra: IProxyItem[] = [],
): Record<string, IProxyItem> => {
  const result: Record<string, IProxyItem> = {};
  proxies.forEach((item, key) => {
    result[key] = item;
  });
  groups.forEach((group) => {
    result[group.name] = group as unknown as IProxyItem;
  });
  extra.forEach((item) => {
    result[item.name] = item;
  });
  return result;
};

export const createProxySnapshotFromProfile = (
  yamlContent: string,
): {
  global: IProxyGroupItem;
  direct: IProxyItem;
  groups: IProxyGroupItem[];
  records: Record<string, IProxyItem>;
  proxies: IProxyItem[];
} | null => {
  let parsed: any;
  try {
    parsed = yaml.load(yamlContent);
  } catch (error) {
    console.warn("[ProxySnapshot] Failed to parse YAML:", error);
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const proxyMap = new Map<string, IProxyItem>();

  if (Array.isArray((parsed as any).proxies)) {
    for (const entry of (parsed as any).proxies) {
      const item = parseProxyEntry(entry);
      if (item) {
        proxyMap.set(item.name, item);
      }
    }
  }

  const proxyProviders = (parsed as any)["proxy-providers"];
  if (proxyProviders && typeof proxyProviders === "object") {
    for (const key of Object.keys(proxyProviders)) {
      const provider = proxyProviders[key];
      if (provider && Array.isArray(provider.proxies)) {
        provider.proxies
          .filter(
            (proxyName: unknown): proxyName is string =>
              typeof proxyName === "string",
          )
          .forEach((proxyName: string) => ensureProxyItem(proxyMap, proxyName));
      }
    }
  }

  const groups: IProxyGroupItem[] = [];
  if (Array.isArray((parsed as any)["proxy-groups"])) {
    for (const entry of (parsed as any)["proxy-groups"]) {
      const groupItem = parseProxyGroup(entry, proxyMap);
      if (groupItem) {
        groups.push(groupItem);
      }
    }
  }

  const direct = createProxyItem("DIRECT", { type: "Direct" });
  const reject = createProxyItem("REJECT", { type: "Reject" });

  ensureProxyItem(proxyMap, direct.name, direct);
  ensureProxyItem(proxyMap, reject.name, reject);

  let global = groups.find((group) => group.name === "GLOBAL");
  if (!global) {
    const globalRefs = groups.flatMap((group) =>
      group.all.map((proxy) => proxy.name),
    );
    const unique = Array.from(new Set(globalRefs));
    const all = unique.map((name) => ensureProxyItem(proxyMap, name));
    global = createGroupItem("GLOBAL", all, { type: "Selector" });
    groups.unshift(global);
  }

  const proxies = Array.from(proxyMap.values()).filter(
    (item) => !groups.some((group) => group.name === item.name),
  );

  const records = mapRecords(proxyMap, groups, [direct, reject]);

  return {
    global,
    direct,
    groups,
    records,
    proxies,
  };
};
