import type { ConnectionMetaData } from "./ConnectionMetaData";
export type Connection = {
    id: string;
    metadata: ConnectionMetaData;
    upload: bigint;
    download: bigint;
    start: string;
    chains: Array<string>;
    rule: string;
    rulePayload: string;
};
