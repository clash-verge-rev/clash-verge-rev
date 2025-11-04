import {
  DataGrid,
  GridColDef,
  GridColumnResizeParams,
  useGridApiRef,
} from "@mui/x-data-grid";
import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import { useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import parseTraffic from "@/utils/parse-traffic";
import { truncateStr } from "@/utils/truncate-str";

interface Props {
  connections: IConnectionsItem[];
  onShowDetail: (data: IConnectionsItem) => void;
}

export const ConnectionTable = (props: Props) => {
  const { connections, onShowDetail } = props;
  const { t } = useTranslation();
  const apiRef = useGridApiRef();
  useLayoutEffect(() => {
    const PATCH_FLAG_KEY = "__clashPatchedPublishEvent" as const;
    const ORIGINAL_KEY = "__clashOriginalPublishEvent" as const;
    let isUnmounted = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;
    let cleanupOriginal: (() => void) | null = null;

    const scheduleRetry = () => {
      if (isUnmounted || retryHandle !== null) return;
      retryHandle = setTimeout(() => {
        retryHandle = null;
        ensurePatched();
      }, 16);
    };

    // Safari occasionally emits grid events without an event object,
    // and MUI expects `defaultMuiPrevented` to exist. Normalize here to avoid crashes.
    const createFallbackEvent = () => {
      const fallback = {
        defaultMuiPrevented: false,
        preventDefault() {
          fallback.defaultMuiPrevented = true;
        },
      };
      return fallback;
    };

    const ensureMuiEvent = (
      value: unknown,
    ): {
      defaultMuiPrevented: boolean;
      preventDefault: () => void;
      [key: string]: unknown;
    } => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createFallbackEvent();
      }

      const eventObject = value as {
        defaultMuiPrevented?: unknown;
        preventDefault?: () => void;
        [key: string]: unknown;
      };

      if (typeof eventObject.defaultMuiPrevented !== "boolean") {
        eventObject.defaultMuiPrevented = false;
      }

      if (typeof eventObject.preventDefault !== "function") {
        eventObject.preventDefault = () => {
          eventObject.defaultMuiPrevented = true;
        };
      }

      return eventObject as {
        defaultMuiPrevented: boolean;
        preventDefault: () => void;
        [key: string]: unknown;
      };
    };

    const ensurePatched = () => {
      if (isUnmounted) return;
      const api = apiRef.current;

      if (!api?.publishEvent) {
        scheduleRetry();
        return;
      }

      const metadataApi = api as unknown as typeof api &
        Record<string, unknown>;
      if (metadataApi[PATCH_FLAG_KEY] === true) return;

      const originalPublishEvent = api.publishEvent;

      // Use Proxy to create a more resilient wrapper that always normalizes events
      const patchedPublishEvent = new Proxy(originalPublishEvent, {
        apply(target, thisArg, rawArgs: unknown[]) {
          rawArgs[2] = ensureMuiEvent(rawArgs[2]);

          return Reflect.apply(
            target as (...args: unknown[]) => unknown,
            thisArg,
            rawArgs,
          );
        },
      }) as typeof originalPublishEvent;

      api.publishEvent = patchedPublishEvent;
      metadataApi[PATCH_FLAG_KEY] = true;
      metadataApi[ORIGINAL_KEY] = originalPublishEvent;

      cleanupOriginal = () => {
        const storedOriginal = metadataApi[ORIGINAL_KEY] as
          | typeof originalPublishEvent
          | undefined;

        api.publishEvent = (
          typeof storedOriginal === "function"
            ? storedOriginal
            : originalPublishEvent
        ) as typeof originalPublishEvent;

        delete metadataApi[PATCH_FLAG_KEY];
        delete metadataApi[ORIGINAL_KEY];
      };
    };

    ensurePatched();

    return () => {
      isUnmounted = true;
      if (retryHandle !== null) {
        clearTimeout(retryHandle);
        retryHandle = null;
      }
      if (cleanupOriginal) {
        cleanupOriginal();
        cleanupOriginal = null;
      }
    };
  }, [apiRef]);

  const [columnVisible, setColumnVisible] = useState<
    Partial<Record<keyof IConnectionsItem, boolean>>
  >({});

  const [columnWidths, setColumnWidths] = useLocalStorage<
    Record<string, number>
  >(
    "connection-table-widths",
    // server-side value, this is the default value used by server-side rendering (if any)
    // Do not omit (otherwise a Suspense boundary will be triggered)
    {},
  );

  const columns = useMemo<GridColDef[]>(() => {
    return [
      {
        field: "host",
        headerName: t("entities.connection.fields.host"),
        width: columnWidths["host"] || 220,
        minWidth: 180,
      },
      {
        field: "download",
        headerName: t("entities.connection.fields.downloaded"),
        width: columnWidths["download"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" "),
      },
      {
        field: "upload",
        headerName: t("entities.connection.fields.uploaded"),
        width: columnWidths["upload"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" "),
      },
      {
        field: "dlSpeed",
        headerName: t("entities.connection.fields.dlSpeed"),
        width: columnWidths["dlSpeed"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
      },
      {
        field: "ulSpeed",
        headerName: t("entities.connection.fields.ulSpeed"),
        width: columnWidths["ulSpeed"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
      },
      {
        field: "chains",
        headerName: t("entities.connection.fields.chains"),
        width: columnWidths["chains"] || 340,
        minWidth: 180,
      },
      {
        field: "rule",
        headerName: t("entities.connection.fields.rule"),
        width: columnWidths["rule"] || 280,
        minWidth: 180,
      },
      {
        field: "process",
        headerName: t("entities.connection.fields.process"),
        width: columnWidths["process"] || 220,
        minWidth: 180,
      },
      {
        field: "time",
        headerName: t("entities.connection.fields.time"),
        width: columnWidths["time"] || 120,
        minWidth: 100,
        align: "right",
        headerAlign: "right",
        sortComparator: (v1: string, v2: string) =>
          new Date(v2).getTime() - new Date(v1).getTime(),
        valueFormatter: (value: number) => dayjs(value).fromNow(),
      },
      {
        field: "source",
        headerName: t("entities.connection.fields.source"),
        width: columnWidths["source"] || 200,
        minWidth: 130,
      },
      {
        field: "remoteDestination",
        headerName: t("entities.connection.fields.destination"),
        width: columnWidths["remoteDestination"] || 200,
        minWidth: 130,
      },
      {
        field: "type",
        headerName: t("entities.connection.fields.type"),
        width: columnWidths["type"] || 160,
        minWidth: 100,
      },
    ];
  }, [columnWidths, t]);

  const handleColumnResize = (params: GridColumnResizeParams) => {
    const { colDef, width } = params;
    setColumnWidths((prev) => ({
      ...prev,
      [colDef.field]: width,
    }));
  };

  const connRows = useMemo(() => {
    return connections.map((each) => {
      const { metadata, rulePayload } = each;
      const chains = [...each.chains].reverse().join(" / ");
      const rule = rulePayload ? `${each.rule}(${rulePayload})` : each.rule;
      const Destination = metadata.destinationIP
        ? `${metadata.destinationIP}:${metadata.destinationPort}`
        : `${metadata.remoteDestination}:${metadata.destinationPort}`;
      return {
        id: each.id,
        host: metadata.host
          ? `${metadata.host}:${metadata.destinationPort}`
          : `${metadata.remoteDestination}:${metadata.destinationPort}`,
        download: each.download,
        upload: each.upload,
        dlSpeed: each.curDownload,
        ulSpeed: each.curUpload,
        chains,
        rule,
        process: truncateStr(metadata.process || metadata.processPath),
        time: each.start,
        source: `${metadata.sourceIP}:${metadata.sourcePort}`,
        remoteDestination: Destination,
        type: `${metadata.type}(${metadata.network})`,
        connectionData: each,
      };
    });
  }, [connections]);

  return (
    <DataGrid
      apiRef={apiRef}
      hideFooter
      rows={connRows}
      columns={columns}
      onRowClick={(e) => onShowDetail(e.row.connectionData)}
      density="compact"
      sx={{
        border: "none",
        "div:focus": { outline: "none !important" },
        "& .MuiDataGrid-columnHeader": {
          userSelect: "none",
        },
      }}
      columnVisibilityModel={columnVisible}
      onColumnVisibilityModelChange={(e) => setColumnVisible(e)}
      onColumnResize={handleColumnResize}
      disableColumnMenu={false}
    />
  );
};
