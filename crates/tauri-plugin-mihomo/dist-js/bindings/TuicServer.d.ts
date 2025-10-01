import type { MuxOption } from "./MuxOption";
export type TuicServer = {
    enable: boolean;
    listen: string;
    token?: Array<string>;
    users?: {
        [key in string]?: string;
    };
    certificate: string;
    privateKey: string;
    echKey: string;
    congestionController?: string;
    maxIdleTime?: number;
    authenticationTimeout?: number;
    alpn?: Array<string>;
    maxUdpRelayPacketSize?: number;
    maxDatagramFrameSize?: number;
    cwnd?: number;
    muxOption?: MuxOption;
};
