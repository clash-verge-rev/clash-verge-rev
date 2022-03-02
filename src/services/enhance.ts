import { emit, listen } from "@tauri-apps/api/event";
import { CmdType } from "./types";

export default function setup() {
  listen("script-handler", (event) => {
    const payload = event.payload as CmdType.EnhancedPayload;
    console.log(payload);

    // setTimeout(() => {
    //   try {
    //     const fn = eval(payload.script + "\n\nmixin");
    //     console.log(fn);

    //     const result = fn(payload.params || {});
    //     console.log("result", result);
    //     emit(payload.callback, JSON.stringify(result)).catch(console.error);
    //   } catch (err) {
    //     console.error(err);
    //   }
    // }, 3000);
  });
}
