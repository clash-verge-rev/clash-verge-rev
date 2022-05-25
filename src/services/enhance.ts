import { emit, listen, Event } from "@tauri-apps/api/event";
import { appWindow } from "@tauri-apps/api/window";
import { CmdType } from "./types";
import ignoreCase from "../utils/ignore-case";

const DEFAULT_FIELDS = [
  "rules",
  "proxies",
  "proxy-groups",
  "proxy-providers",
  "rule-providers",
] as const;

const USE_FLAG_FIELDS = [
  "tun",
  "dns",
  "hosts",
  "script",
  "profile",
  "payload",
  "interface-name",
  "routing-mark",
] as const;

/**
 * process the merge mode
 */
function toMerge(merge: CmdType.ProfileMerge, data: CmdType.ProfileData) {
  if (!merge) return { data, use: [] };

  const {
    use,
    "prepend-rules": preRules,
    "append-rules": postRules,
    "prepend-proxies": preProxies,
    "append-proxies": postProxies,
    "prepend-proxy-groups": preProxyGroups,
    "append-proxy-groups": postProxyGroups,
    ...mergeConfig
  } = merge;

  [...DEFAULT_FIELDS, ...USE_FLAG_FIELDS].forEach((key) => {
    // the value should not be null
    if (mergeConfig[key] != null) {
      data[key] = mergeConfig[key];
    }
  });

  // init
  if (!data.rules) data.rules = [];
  if (!data.proxies) data.proxies = [];
  if (!data["proxy-groups"]) data["proxy-groups"] = [];

  // rules
  if (Array.isArray(preRules)) {
    data.rules.unshift(...preRules);
  }
  if (Array.isArray(postRules)) {
    data.rules.push(...postRules);
  }

  // proxies
  if (Array.isArray(preProxies)) {
    data.proxies.unshift(...preProxies);
  }
  if (Array.isArray(postProxies)) {
    data.proxies.push(...postProxies);
  }

  // proxy-groups
  if (Array.isArray(preProxyGroups)) {
    data["proxy-groups"].unshift(...preProxyGroups);
  }
  if (Array.isArray(postProxyGroups)) {
    data["proxy-groups"].push(...postProxyGroups);
  }

  return { data, use: Array.isArray(use) ? use : [] };
}

/**
 * process the script mode
 */
function toScript(
  script: string,
  data: CmdType.ProfileData
): Promise<CmdType.ProfileData> {
  if (!script) {
    throw new Error("miss the main function");
  }

  const paramsName = `__verge${Math.floor(Math.random() * 1000)}`;
  const code = `'use strict';${script};return main(${paramsName});`;
  const func = new Function(paramsName, code);
  return func(data);
}

export type EStatus = { status: "ok" | "error"; message?: string };
export type EListener = (status: EStatus) => void;
export type EUnlistener = () => void;

/**
 * The service helps to
 * implement enhanced profiles
 */
class Enhance {
  private isSetup = false;
  private listenMap: Map<string, EListener>;
  private resultMap: Map<string, EStatus>;

  constructor() {
    this.listenMap = new Map();
    this.resultMap = new Map();
  }

  // setup some listener
  // for the enhanced running status
  listen(uid: string, cb: EListener): EUnlistener {
    this.listenMap.set(uid, cb);
    return () => this.listenMap.delete(uid);
  }

  // get the running status
  status(uid: string): EStatus | undefined {
    return this.resultMap.get(uid);
  }

  async enhanceHandler(event: Event<unknown>) {
    const payload = event.payload as CmdType.EnhancedPayload;

    const result = await this.runner(payload).catch((err: any) => ({
      data: null,
      status: "error",
      error: err.message,
    }));

    emit(payload.callback, JSON.stringify(result)).catch(console.error);
  }
  // setup the handler
  setup() {
    if (this.isSetup) return;
    this.isSetup = true;

    listen("script-handler", async (event) => {
      await this.enhanceHandler(event);
    });

    listen("script-handler-close", async (event) => {
      await this.enhanceHandler(event);
      appWindow.close();
    });
  }

  // enhanced mode runner
  private async runner(payload: CmdType.EnhancedPayload) {
    const chain = payload.chain || [];
    const valid = payload.valid || [];

    if (!Array.isArray(chain)) throw new Error("unhandle error");

    let pdata = payload.current || {};
    let useList = valid;

    for (const each of chain) {
      const { uid, type = "" } = each.item;

      try {
        // process script
        if (type === "script") {
          // support async main function
          pdata = await toScript(each.script!, ignoreCase(pdata));
        }

        // process merge
        else if (type === "merge") {
          const temp = toMerge(each.merge!, ignoreCase(pdata));
          pdata = temp.data;
          useList = useList.concat(temp.use || []);
        }

        // invalid type
        else {
          throw new Error(`invalid enhanced profile type "${type}"`);
        }

        this.exec(uid, { status: "ok" });
      } catch (err: any) {
        console.error(err);

        this.exec(uid, {
          status: "error",
          message: err.message || err.toString(),
        });
      }
    }

    pdata = ignoreCase(pdata);

    // filter the data
    const filterData: typeof pdata = {};
    Object.keys(pdata).forEach((key: any) => {
      if (
        DEFAULT_FIELDS.includes(key) ||
        (USE_FLAG_FIELDS.includes(key) && useList.includes(key))
      ) {
        filterData[key] = pdata[key];
      }
    });

    return { data: filterData, status: "ok" };
  }

  // exec the listener
  private exec(uid: string, status: EStatus) {
    this.resultMap.set(uid, status);
    this.listenMap.get(uid)?.(status);
  }
}

export default new Enhance();
