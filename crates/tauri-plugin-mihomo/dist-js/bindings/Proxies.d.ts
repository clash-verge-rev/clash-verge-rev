import type { Proxy } from "./Proxy";
/**
 * proxies
 */
export type Proxies = {
    proxies: {
        [key in string]?: Proxy;
    };
};
