import { emit, listen } from "@tauri-apps/api/event";
import { CmdType } from "./types";

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
  return func(data); // support async main function
}

export default function setup() {
  listen("script-handler", async (event) => {
    const payload = event.payload as CmdType.EnhancedPayload;
    console.log(payload);

    let pdata = payload.current || {};

    for (const each of payload.chain) {
      try {
        // process script
        if (each.item.type === "script") {
          pdata = await toScript(each.script!, pdata);
        }

        // process merge
        else if (each.item.type === "merge") {
          pdata = toMerge(each.merge!, pdata);
        }

        // invalid type
        else {
          throw new Error(`invalid enhanced profile type "${each.item.type}"`);
        }

        console.log("step", pdata);
      } catch (err) {
        console.error(err);
      }
    }

    const result: CmdType.EnhancedResult = {
      data: pdata,
      status: "success",
    };

    emit(payload.callback, JSON.stringify(result)).catch(console.error);
  });

  // enhanceProfiles();
}
