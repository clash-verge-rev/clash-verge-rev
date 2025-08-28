import type { Connection } from "./Connection";
/**
 * connections
 */
export type Connections = {
    downloadTotal: bigint;
    uploadTotal: bigint;
    connections: Array<Connection>;
    memory: number;
};
