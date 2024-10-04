import clc from "cli-color";

export const log_success = (msg, ...optionalParams) =>
  console.log(clc.green(msg), ...optionalParams);
export const log_error = (msg, ...optionalParams) =>
  console.log(clc.red(msg), ...optionalParams);
export const log_info = (msg, ...optionalParams) =>
  console.log(clc.bgBlue(msg), ...optionalParams);
var debugMsg = clc.xterm(245);
export const log_debug = (msg, ...optionalParams) =>
  console.log(debugMsg(msg), ...optionalParams);
