import { Box } from "@mui/material";
import {
  DataGrid,
  GridColDef,
  GridColumnOrderChangeParams,
  GridColumnResizeParams,
  GridColumnVisibilityModel,
  useGridApiRef,
  GridColumnMenuItemProps,
  GridColumnMenuHideItem,
  useGridRootProps,
} from "@mui/x-data-grid";
import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  createContext,
  use,
} from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import parseTraffic from "@/utils/parse-traffic";
import { truncateStr } from "@/utils/truncate-str";

import { ConnectionColumnManager } from "./connection-column-manager";

const ColumnManagerContext = createContext<() => void>(() => {});

/**
 * Reconcile stored column order with base columns to handle added/removed fields
 */
const reconcileColumnOrder = (
  storedOrder: string[],
  baseFields: string[],
): string[] => {
  const filtered = storedOrder.filter((field) => baseFields.includes(field));
  const missing = baseFields.filter((field) => !filtered.includes(field));
  return [...filtered, ...missing];
};

interface Props {
  connections: IConnectionsItem[];
  onShowDetail: (data: IConnectionsItem) => void;
  columnManagerOpen: boolean;
  onOpenColumnManager: () => void;
  onCloseColumnManager: () => void;
}

export const ConnectionTable = (props: Props) => {
  const {
    connections,
    onShowDetail,
    columnManagerOpen,
    onOpenColumnManager,
    onCloseColumnManager,
  } = props;
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

  const [columnWidths, setColumnWidths] = useLocalStorage<
    Record<string, number>
  >(
    "connection-table-widths",
    // server-side value, this is the default value used by server-side rendering (if any)
    // Do not omit (otherwise a Suspense boundary will be triggered)
    {},
  );

  const [columnVisibilityModel, setColumnVisibilityModel] = useLocalStorage<
    Partial<Record<string, boolean>>
  >(
    "connection-table-visibility",
    {},
    {
      serializer: JSON.stringify,
      deserializer: (value) => {
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === "object") return parsed;
        } catch (err) {
          console.warn("Failed to parse connection-table-visibility", err);
        }
        return {};
      },
    },
  );

  const [columnOrder, setColumnOrder] = useLocalStorage<string[]>(
    "connection-table-order",
    [],
    {
      serializer: JSON.stringify,
      deserializer: (value) => {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch (err) {
          console.warn("Failed to parse connection-table-order", err);
        }
        return [];
      },
    },
  );

  const baseColumns = useMemo<GridColDef[]>(() => {
    return [
      {
        field: "host",
        headerName: t("connections.components.fields.host"),
        width: columnWidths["host"] || 220,
        minWidth: 180,
      },
      {
        field: "download",
        headerName: t("shared.labels.downloaded"),
        width: columnWidths["download"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" "),
      },
      {
        field: "upload",
        headerName: t("shared.labels.uploaded"),
        width: columnWidths["upload"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" "),
      },
      {
        field: "dlSpeed",
        headerName: t("connections.components.fields.dlSpeed"),
        width: columnWidths["dlSpeed"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
      },
      {
        field: "ulSpeed",
        headerName: t("connections.components.fields.ulSpeed"),
        width: columnWidths["ulSpeed"] || 88,
        align: "right",
        headerAlign: "right",
        valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
      },
      {
        field: "chains",
        headerName: t("connections.components.fields.chains"),
        width: columnWidths["chains"] || 340,
        minWidth: 180,
      },
      {
        field: "rule",
        headerName: t("connections.components.fields.rule"),
        width: columnWidths["rule"] || 280,
        minWidth: 180,
      },
      {
        field: "process",
        headerName: t("connections.components.fields.process"),
        width: columnWidths["process"] || 220,
        minWidth: 180,
      },
      {
        field: "time",
        headerName: t("connections.components.fields.time"),
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
        headerName: t("connections.components.fields.source"),
        width: columnWidths["source"] || 200,
        minWidth: 130,
      },
      {
        field: "remoteDestination",
        headerName: t("connections.components.fields.destination"),
        width: columnWidths["remoteDestination"] || 200,
        minWidth: 130,
      },
      {
        field: "type",
        headerName: t("connections.components.fields.type"),
        width: columnWidths["type"] || 160,
        minWidth: 100,
      },
    ];
  }, [columnWidths, t]);

  useEffect(() => {
    setColumnOrder((prevValue) => {
      const baseFields = baseColumns.map((col) => col.field);
      const prev = Array.isArray(prevValue) ? prevValue : [];
      const reconciled = reconcileColumnOrder(prev, baseFields);
      if (
        reconciled.length === prev.length &&
        reconciled.every((field, i) => field === prev[i])
      ) {
        return prevValue;
      }
      return reconciled;
    });
  }, [baseColumns, setColumnOrder]);

  const columns = useMemo<GridColDef[]>(() => {
    const order = Array.isArray(columnOrder) ? columnOrder : [];
    const orderMap = new Map(order.map((field, index) => [field, index]));

    return [...baseColumns].sort((a, b) => {
      const aIndex = orderMap.has(a.field)
        ? (orderMap.get(a.field) as number)
        : Number.MAX_SAFE_INTEGER;
      const bIndex = orderMap.has(b.field)
        ? (orderMap.get(b.field) as number)
        : Number.MAX_SAFE_INTEGER;

      if (aIndex === bIndex) {
        return order.indexOf(a.field) - order.indexOf(b.field);
      }

      return aIndex - bIndex;
    });
  }, [baseColumns, columnOrder]);

  const visibleColumnsCount = useMemo(() => {
    return columns.reduce((count, column) => {
      return (columnVisibilityModel?.[column.field] ?? true) !== false
        ? count + 1
        : count;
    }, 0);
  }, [columns, columnVisibilityModel]);

  const handleColumnResize = (params: GridColumnResizeParams) => {
    const { colDef, width } = params;
    setColumnWidths((prev) => ({
      ...prev,
      [colDef.field]: width,
    }));
  };

  const handleColumnVisibilityChange = useCallback(
    (model: GridColumnVisibilityModel) => {
      const hiddenFields = new Set<string>();
      Object.entries(model).forEach(([field, value]) => {
        if (value === false) {
          hiddenFields.add(field);
        }
      });

      const nextVisibleCount = columns.reduce((count, column) => {
        return hiddenFields.has(column.field) ? count : count + 1;
      }, 0);

      if (nextVisibleCount === 0) {
        return;
      }

      setColumnVisibilityModel(() => {
        const sanitized: Partial<Record<string, boolean>> = {};
        hiddenFields.forEach((field) => {
          sanitized[field] = false;
        });
        return sanitized;
      });
    },
    [columns, setColumnVisibilityModel],
  );

  const handleToggleColumn = useCallback(
    (field: string, visible: boolean) => {
      if (!visible && visibleColumnsCount <= 1) {
        return;
      }

      setColumnVisibilityModel((prev) => {
        const next = { ...(prev ?? {}) };
        if (visible) {
          delete next[field];
        } else {
          next[field] = false;
        }
        return next;
      });
    },
    [setColumnVisibilityModel, visibleColumnsCount],
  );

  const handleColumnOrderChange = useCallback(
    (params: GridColumnOrderChangeParams) => {
      setColumnOrder((prevValue) => {
        const baseFields = baseColumns.map((col) => col.field);
        const currentOrder = Array.isArray(prevValue)
          ? [...prevValue]
          : [...baseFields];
        const field = params.column.field;
        const currentIndex = currentOrder.indexOf(field);
        if (currentIndex === -1) return currentOrder;

        currentOrder.splice(currentIndex, 1);
        const targetIndex = Math.min(
          Math.max(params.targetIndex, 0),
          currentOrder.length,
        );
        currentOrder.splice(targetIndex, 0, field);

        return currentOrder;
      });
    },
    [baseColumns, setColumnOrder],
  );

  const handleManagerOrderChange = useCallback(
    (order: string[]) => {
      setColumnOrder(() => {
        const baseFields = baseColumns.map((col) => col.field);
        return reconcileColumnOrder(order, baseFields);
      });
    },
    [baseColumns, setColumnOrder],
  );

  const handleResetColumns = useCallback(() => {
    setColumnVisibilityModel({});
    setColumnOrder(baseColumns.map((col) => col.field));
  }, [baseColumns, setColumnOrder, setColumnVisibilityModel]);

  const gridVisibilityModel = useMemo(() => {
    const result: GridColumnVisibilityModel = {};
    if (!columnVisibilityModel) return result;
    Object.entries(columnVisibilityModel).forEach(([field, value]) => {
      if (typeof value === "boolean") {
        result[field] = value;
      }
    });
    return result;
  }, [columnVisibilityModel]);

  const columnOptions = useMemo(() => {
    return columns.map((column) => ({
      field: column.field,
      label: column.headerName ?? column.field,
      visible: (columnVisibilityModel?.[column.field] ?? true) !== false,
    }));
  }, [columns, columnVisibilityModel]);

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
    <ColumnManagerContext value={onOpenColumnManager}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <DataGrid
          apiRef={apiRef}
          rows={connRows}
          columns={columns}
          onRowClick={(e) => onShowDetail(e.row.connectionData)}
          density="compact"
          sx={{
            flex: 1,
            border: "none",
            minHeight: 0,
            "div:focus": { outline: "none !important" },
            "& .MuiDataGrid-columnHeader": {
              userSelect: "none",
            },
          }}
          columnVisibilityModel={gridVisibilityModel}
          onColumnVisibilityModelChange={handleColumnVisibilityChange}
          onColumnResize={handleColumnResize}
          onColumnOrderChange={handleColumnOrderChange}
          slotProps={{
            columnMenu: {
              slots: {
                columnMenuColumnsItem: ConnectionColumnMenuColumnsItem,
              },
            },
          }}
        />
      </Box>
      <ConnectionColumnManager
        open={columnManagerOpen}
        columns={columnOptions}
        onClose={onCloseColumnManager}
        onToggle={handleToggleColumn}
        onOrderChange={handleManagerOrderChange}
        onReset={handleResetColumns}
      />
    </ColumnManagerContext>
  );
};

type ConnectionColumnMenuManageItemProps = GridColumnMenuItemProps & {
  onOpenColumnManager: () => void;
};

const ConnectionColumnMenuManageItem = (
  props: ConnectionColumnMenuManageItemProps,
) => {
  const { onClick, onOpenColumnManager } = props;
  const rootProps = useGridRootProps();
  const { t } = useTranslation();
  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      onClick(event);
      onOpenColumnManager();
    },
    [onClick, onOpenColumnManager],
  );

  if (rootProps.disableColumnSelector) {
    return null;
  }

  const MenuItem = rootProps.slots.baseMenuItem;
  const Icon = rootProps.slots.columnMenuManageColumnsIcon;

  return (
    <MenuItem onClick={handleClick} iconStart={<Icon fontSize="small" />}>
      {t("connections.components.columnManager.title")}
    </MenuItem>
  );
};

const ConnectionColumnMenuColumnsItem = (props: GridColumnMenuItemProps) => {
  const onOpenColumnManager = use(ColumnManagerContext);

  return (
    <>
      <GridColumnMenuHideItem {...props} />
      <ConnectionColumnMenuManageItem
        {...props}
        onOpenColumnManager={onOpenColumnManager}
      />
    </>
  );
};
