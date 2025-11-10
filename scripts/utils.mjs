import clc from "cli-color";
import fetch from "node-fetch";

export const log_success = (msg, ...optionalParams) =>
  console.log(clc.green(msg), ...optionalParams);
export const log_error = (msg, ...optionalParams) =>
  console.log(clc.red(msg), ...optionalParams);
export const log_info = (msg, ...optionalParams) =>
  console.log(clc.bgBlue(msg), ...optionalParams);
var debugMsg = clc.xterm(245);
export const log_debug = (msg, ...optionalParams) =>
  console.log(debugMsg(msg), ...optionalParams);

/**
 * Fetch the signature file content from a URL
 * @param {string} url - The URL to fetch the signature from
 * @returns {Promise<string>} The signature content
 */
export async function getSignature(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });

  return response.text();
}

/**
 * Architecture mappings for portable builds
 */
export const ARCH_MAP = {
  "x86_64-pc-windows-msvc": "x64",
  "i686-pc-windows-msvc": "x86",
  "aarch64-pc-windows-msvc": "arm64",
};

export const PROCESS_MAP = {
  x64: "x64",
  ia32: "x86",
  arm64: "arm64",
};

/**
 * Get the architecture string from target or process
 * @param {string|undefined} target - The build target
 * @returns {string} The architecture string
 */
export function getArch(target) {
  return target ? ARCH_MAP[target] : PROCESS_MAP[process.arch];
}
