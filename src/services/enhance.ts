import { emit, listen } from "@tauri-apps/api/event";
import { CmdType } from "./types";

/**
 * process the merge mode
 */
function toMerge(
  merge: CmdType.ProfileMerge,
  data: CmdType.ProfileData
): CmdType.ProfileData {
  if (!merge) return data;

  const newData = { ...data };

  // rules
  if (Array.isArray(merge["prepend-rules"])) {
    if (!newData.rules) newData.rules = [];
    newData.rules.unshift(...merge["prepend-rules"]);
  }
  if (Array.isArray(merge["append-rules"])) {
    if (!newData.rules) newData.rules = [];
    newData.rules.push(...merge["append-rules"]);
  }

  // proxies
  if (Array.isArray(merge["prepend-proxies"])) {
    if (!newData.proxies) newData.proxies = [];
    newData.proxies.unshift(...merge["prepend-proxies"]);
  }
  if (Array.isArray(merge["append-proxies"])) {
    if (!newData.proxies) newData.proxies = [];
    newData.proxies.push(...merge["append-proxies"]);
  }

  // proxy-groups
  if (Array.isArray(merge["prepend-proxy-groups"])) {
    if (!newData["proxy-groups"]) newData["proxy-groups"] = [];
    newData["proxy-groups"].unshift(...merge["prepend-proxy-groups"]);
  }
  if (Array.isArray(merge["append-proxy-groups"])) {
    if (!newData["proxy-groups"]) newData["proxy-groups"] = [];
    newData["proxy-groups"].push(...merge["append-proxy-groups"]);
  }

  return newData;
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

  // setup the handler
  setup() {
    if (this.isSetup) return;
    this.isSetup = true;

    listen("script-handler", async (event) => {
      const payload = event.payload as CmdType.EnhancedPayload;
      let pdata = payload.current || {};

      let hasScript = false;

      for (const each of payload.chain) {
        const { uid, type = "" } = each.item;

        try {
          // process script
          if (type === "script") {
            // support async main function
            pdata = await toScript(each.script!, { ...pdata });
            hasScript = true;
          }

          // process merge
          else if (type === "merge") {
            pdata = toMerge(each.merge!, { ...pdata });
          }

          // invalid type
          else {
            throw new Error(`invalid enhanced profile type "${type}"`);
          }

          this.exec(uid, { status: "ok" });
        } catch (err: any) {
          this.exec(uid, {
            status: "error",
            message: err.message || err.toString(),
          });

          console.error(err);
        }
      }

      // If script is never used
      // filter other fields
      if (!hasScript) {
        const validKeys = [
          "proxies",
          "proxy-providers",
          "proxy-groups",
          "rule-providers",
          "rules",
        ];

        // to lowercase
        const newData: any = {};
        Object.keys(pdata).forEach((key) => {
          const newKey = key.toLowerCase();
          if (validKeys.includes(newKey)) {
            newData[newKey] = (pdata as any)[key];
          }
        });

        pdata = newData;
      }

      const result = { data: pdata, status: "ok" };
      emit(payload.callback, JSON.stringify(result)).catch(console.error);
    });
  }

  // exec the listener
  private exec(uid: string, status: EStatus) {
    this.resultMap.set(uid, status);
    this.listenMap.get(uid)?.(status);
  }
}

export default new Enhance();
