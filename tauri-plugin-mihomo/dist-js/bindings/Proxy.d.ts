import type { DelayHistory } from "./DelayHistory";
import type { Extra } from "./Extra";
import type { ProxyType } from "./ProxyType";
export type Proxy = {
    all?: Array<string>;
    expectedStatus?: string;
    fixed?: string;
    hidden?: boolean;
    icon?: string;
    now?: string;
    testUrl?: string;
    id?: string;
    alive: boolean;
    history: Array<DelayHistory>;
    extra: {
        [key in string]?: Extra;
    };
    name: string;
    udp: boolean;
    uot: boolean;
    type: ProxyType;
    xudp: boolean;
    tfo: boolean;
    mptcp: boolean;
    smux: boolean;
    interface: string;
    dialerProxy: string;
    routingMark: number;
};
