import { ViewColumnRounded } from "@mui/icons-material";
import { Box, IconButton, Tooltip } from "@mui/material";
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  Updater,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import dayjs from "dayjs";
import { useLocalStorage } from "foxact/use-local-storage";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import parseTraffic from "@/utils/parse-traffic";
import { truncateStr } from "@/utils/truncate-str";

import { ConnectionColumnManager } from "./connection-column-manager";

const ROW_HEIGHT = 40;

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

const createConnectionRow = (each: IConnectionsItem) => {
  const { metadata, rulePayload } = each;
  const chains = [...each.chains].reverse().join(" / ");
  const rule = rulePayload ? `${each.rule}(${rulePayload})` : each.rule;
  const destination = metadata.destinationIP
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
    remoteDestination: destination,
    type: `${metadata.type}(${metadata.network})`,
    connectionData: each,
  };
};

type ConnectionRow = ReturnType<typeof createConnectionRow>;

const areRowsEqual = (a: ConnectionRow, b: ConnectionRow) =>
  a.host === b.host &&
  a.download === b.download &&
  a.upload === b.upload &&
  a.dlSpeed === b.dlSpeed &&
  a.ulSpeed === b.ulSpeed &&
  a.chains === b.chains &&
  a.rule === b.rule &&
  a.process === b.process &&
  a.time === b.time &&
  a.source === b.source &&
  a.remoteDestination === b.remoteDestination &&
  a.type === b.type;

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
  const [columnWidths, setColumnWidths] = useLocalStorage<ColumnSizingState>(
    "connection-table-widths",
    // server-side value, this is the default value used by server-side rendering (if any)
    // Do not omit (otherwise a Suspense boundary will be triggered)
    {},
  );

  const [columnVisibilityModel, setColumnVisibilityModel] =
    useLocalStorage<VisibilityState>(
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

  type ColumnField = Exclude<keyof ConnectionRow, "connectionData">;

  interface BaseColumn {
    field: ColumnField;
    headerName: string;
    width?: number;
    minWidth?: number;
    align?: "left" | "right";
    cell?: (row: ConnectionRow) => ReactNode;
  }

  const baseColumns = useMemo<BaseColumn[]>(() => {
    return [
      {
        field: "host",
        headerName: t("connections.components.fields.host"),
        width: 180,
        minWidth: 140,
      },
      {
        field: "download",
        headerName: t("shared.labels.downloaded"),
        width: 76,
        minWidth: 60,
        align: "right",
        cell: (row) => parseTraffic(row.download).join(" "),
      },
      {
        field: "upload",
        headerName: t("shared.labels.uploaded"),
        width: 76,
        minWidth: 60,
        align: "right",
        cell: (row) => parseTraffic(row.upload).join(" "),
      },
      {
        field: "dlSpeed",
        headerName: t("connections.components.fields.dlSpeed"),
        width: 76,
        minWidth: 60,
        align: "right",
        cell: (row) => `${parseTraffic(row.dlSpeed).join(" ")}/s`,
      },
      {
        field: "ulSpeed",
        headerName: t("connections.components.fields.ulSpeed"),
        width: 76,
        minWidth: 60,
        align: "right",
        cell: (row) => `${parseTraffic(row.ulSpeed).join(" ")}/s`,
      },
      {
        field: "chains",
        headerName: t("connections.components.fields.chains"),
        width: 280,
        minWidth: 160,
      },
      {
        field: "rule",
        headerName: t("connections.components.fields.rule"),
        width: 220,
        minWidth: 160,
      },
      {
        field: "process",
        headerName: t("connections.components.fields.process"),
        width: 180,
        minWidth: 140,
      },
      {
        field: "time",
        headerName: t("connections.components.fields.time"),
        width: 100,
        minWidth: 80,
        align: "right",
        // cell filled later with shared relativeNow ticker
      },
      {
        field: "source",
        headerName: t("connections.components.fields.source"),
        width: 160,
        minWidth: 120,
      },
      {
        field: "remoteDestination",
        headerName: t("connections.components.fields.destination"),
        width: 160,
        minWidth: 120,
      },
      {
        field: "type",
        headerName: t("connections.components.fields.type"),
        width: 120,
        minWidth: 80,
      },
    ];
  }, [t]);

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

  const handleColumnVisibilityChange = useCallback(
    (update: Updater<VisibilityState>) => {
      setColumnVisibilityModel((prev) => {
        const current = prev ?? {};
        const nextState =
          typeof update === "function" ? update(current) : update;

        const visibleCount = baseColumns.reduce((count, column) => {
          const isVisible = (nextState[column.field] ?? true) !== false;
          return count + (isVisible ? 1 : 0);
        }, 0);

        if (visibleCount === 0) {
          return current;
        }

        const sanitized: VisibilityState = {};
        baseColumns.forEach((column) => {
          if (nextState[column.field] === false) {
            sanitized[column.field] = false;
          }
        });
        return sanitized;
      });
    },
    [baseColumns, setColumnVisibilityModel],
  );

  const handleColumnOrderChange = useCallback(
    (update: Updater<ColumnOrderState>) => {
      setColumnOrder((prev) => {
        const current = Array.isArray(prev) ? prev : [];
        const nextState =
          typeof update === "function" ? update(current) : update;
        const baseFields = baseColumns.map((col) => col.field);
        return reconcileColumnOrder(nextState, baseFields);
      });
    },
    [baseColumns, setColumnOrder],
  );

  const prevRowsRef = useRef<Map<string, ConnectionRow>>(new Map());

  const connRows = useMemo<ConnectionRow[]>(() => {
    const prevMap = prevRowsRef.current;
    const nextMap = new Map<string, ConnectionRow>();

    const nextRows = connections.map((each) => {
      const nextRow = createConnectionRow(each);
      const prevRow = prevMap.get(each.id);

      if (prevRow && areRowsEqual(prevRow, nextRow)) {
        nextMap.set(each.id, prevRow);
        return prevRow;
      }

      nextMap.set(each.id, nextRow);
      return nextRow;
    });

    prevRowsRef.current = nextMap;
    return nextRows;
  }, [connections]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  const columnDefs = useMemo<ColumnDef<ConnectionRow>[]>(() => {
    return baseColumns.map((column) => {
      const baseCell: ColumnDef<ConnectionRow>["cell"] = column.cell
        ? (ctx) => column.cell?.(ctx.row.original)
        : (ctx) => ctx.getValue() as ReactNode;

      const cell: ColumnDef<ConnectionRow>["cell"] =
        column.field === "time"
          ? (ctx) => dayjs(ctx.row.original.time).from(relativeNow)
          : baseCell;

      return {
        id: column.field,
        accessorKey: column.field,
        header: column.headerName,
        size: column.width,
        minSize: column.minWidth ?? 80,
        enableResizing: true,
        meta: {
          align: column.align ?? "left",
          field: column.field,
        },
        cell,
      } satisfies ColumnDef<ConnectionRow>;
    });
  }, [baseColumns, relativeNow]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const timer = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnWidths((prev) => {
        const prevState = prev ?? {};
        const nextState =
          typeof updater === "function" ? updater(prevState) : updater;
        const sanitized: ColumnSizingState = {};
        Object.entries(nextState).forEach(([key, size]) => {
          if (typeof size === "number" && Number.isFinite(size)) {
            sanitized[key] = size;
          }
        });
        return sanitized;
      });
    },
    [setColumnWidths],
  );

  const table = useReactTable({
    data: connRows,
    state: {
      columnVisibility: columnVisibilityModel ?? {},
      columnSizing: columnWidths,
      columnOrder,
      sorting,
    },
    columnResizeMode: "onChange",
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sorting.length ? getSortedRowModel() : undefined,
    onSortingChange: setSorting,
    onColumnSizingChange: handleColumnSizingChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onColumnOrderChange: handleColumnOrderChange,
    columns: columnDefs,
  });

  const columnOptions = table.getAllLeafColumns().map((column) => ({
    field: column.id,
    label:
      typeof column.columnDef.header === "string"
        ? column.columnDef.header
        : column.id,
    visible: column.getIsVisible(),
  }));

  const handleToggleColumn = useCallback(
    (field: string, visible: boolean) => {
      if (!visible && table.getVisibleLeafColumns().length <= 1) {
        return;
      }

      table.getColumn(field)?.toggleVisibility(visible);
    },
    [table],
  );

  const handleManagerOrderChange = useCallback(
    (order: string[]) => {
      const baseFields = baseColumns.map((col) => col.field);
      table.setColumnOrder(reconcileColumnOrder(order, baseFields));
    },
    [baseColumns, table],
  );

  const handleResetColumns = useCallback(() => {
    table.setColumnVisibility({});
    table.setColumnOrder(baseColumns.map((col) => col.field));
  }, [baseColumns, table]);

  const rows = table.getRowModel().rows;
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const tableWidth = table.getTotalSize();

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          position: "relative",
          fontFamily: (theme) => theme.typography.fontFamily,
        }}
      >
        <Tooltip title={t("connections.components.columnManager.title")}>
          <IconButton
            size="small"
            onClick={onOpenColumnManager}
            sx={{
              position: "absolute",
              top: 4,
              right: 4,
              zIndex: 3,
              backgroundColor: (theme) =>
                theme.palette.mode === "dark"
                  ? theme.palette.background.default
                  : theme.palette.background.paper,
              "&:hover": {
                backgroundColor: (theme) => theme.palette.action.hover,
              },
            }}
          >
            <ViewColumnRounded fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box
          ref={tableContainerRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            borderRadius: 1,
            border: "none",
            "&::-webkit-scrollbar": {
              height: 8,
            },
          }}
        >
          <Box
            sx={{
              minWidth: "100%",
              width: tableWidth,
            }}
          >
            <Box
              sx={{
                position: "sticky",
                top: 0,
                zIndex: 2,
              }}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <Box
                  key={headerGroup.id}
                  sx={{
                    display: "flex",
                    borderBottom: (theme) =>
                      `1px solid ${theme.palette.divider}`,
                    backgroundColor: (theme) => theme.palette.background.paper,
                  }}
                >
                  {headerGroup.headers.map((header) => {
                    if (header.isPlaceholder) {
                      return null;
                    }
                    const meta = header.column.columnDef.meta as {
                      align?: "left" | "right";
                      field: string;
                    };
                    return (
                      <Box
                        key={header.id}
                        sx={{
                          flex: `0 0 ${header.getSize()}px`,
                          minWidth: header.column.columnDef.minSize || 80,
                          maxWidth: header.column.columnDef.maxSize,
                          display: "flex",
                          alignItems: "center",
                          position: "relative",
                          boxSizing: "border-box",
                          fontSize: 13,
                          fontWeight: 600,
                          color: "text.secondary",
                          userSelect: "none",
                          "&:hover": {
                            backgroundColor: (theme) =>
                              theme.palette.action.hover,
                          },
                        }}
                      >
                        <Box
                          component="span"
                          onClick={
                            header.column.getCanSort()
                              ? header.column.getToggleSortingHandler()
                              : undefined
                          }
                          sx={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent:
                              meta?.align === "right"
                                ? "flex-end"
                                : "flex-start",
                            gap: 0.5,
                            px: 1,
                            py: 1,
                            cursor: header.column.getCanSort()
                              ? "pointer"
                              : "default",
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {{
                            asc: "▲",
                            desc: "▼",
                          }[header.column.getIsSorted() as string] ?? null}
                        </Box>
                        {header.column.getCanResize() && (
                          <Box
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                              header.getResizeHandler()(event);
                            }}
                            onTouchStart={(event) => {
                              event.stopPropagation();
                              header.getResizeHandler()(event);
                            }}
                            sx={{
                              cursor: "col-resize",
                              position: "absolute",
                              right: 0,
                              top: 0,
                              width: 4,
                              height: "100%",
                              transform: "translateX(50%)",
                              "&:hover": {
                                backgroundColor: (theme) =>
                                  theme.palette.action.active,
                              },
                            }}
                          />
                        )}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
            <Box
              sx={{
                position: "relative",
                height: totalSize,
              }}
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;

                return (
                  <Box
                    key={row.id}
                    onClick={() => onShowDetail(row.original.connectionData)}
                    sx={{
                      display: "flex",
                      position: "absolute",
                      left: 0,
                      right: 0,
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      borderBottom: (theme) =>
                        `1px solid ${theme.palette.divider}`,
                      cursor: "pointer",
                      "&:hover": {
                        backgroundColor: (theme) => theme.palette.action.hover,
                      },
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as {
                        align?: "left" | "right";
                      };
                      return (
                        <Box
                          key={cell.id}
                          sx={{
                            flex: `0 0 ${cell.column.getSize()}px`,
                            minWidth: cell.column.columnDef.minSize || 80,
                            maxWidth: cell.column.columnDef.maxSize,
                            boxSizing: "border-box",
                            px: 1,
                            fontSize: 13,
                            display: "flex",
                            alignItems: "center",
                            justifyContent:
                              meta?.align === "right"
                                ? "flex-end"
                                : "flex-start",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Box>
      <ConnectionColumnManager
        open={columnManagerOpen}
        columns={columnOptions}
        onClose={onCloseColumnManager}
        onToggle={handleToggleColumn}
        onOrderChange={handleManagerOrderChange}
        onReset={handleResetColumns}
      />
    </>
  );
};
