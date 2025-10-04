import type { Connection } from "./Connection";
/**
 * connections
 */
export type Connections = {
    downloadTotal: number;
    uploadTotal: number;
    connections: Array<Connection> | null;
    memory: number;
};
