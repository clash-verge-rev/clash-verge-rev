import { ViewColumnRounded } from "@mui/icons-material";
import { Box, IconButton, Tooltip } from "@mui/material";
import {
  ColumnDef,
  ColumnSizingState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Updater,
  useReactTable,
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

  const createConnectionRow = (each: IConnectionsItem) => {
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
  };

  type ConnectionRow = ReturnType<typeof createConnectionRow>;

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
        cell: (row) => dayjs(row.time).fromNow(),
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

  const columns = useMemo<BaseColumn[]>(() => {
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

  const handleColumnVisibilityChange = useCallback(
    (update: Updater<VisibilityState>) => {
      setColumnVisibilityModel((prev) => {
        const current = prev ?? {};
        const baseState: VisibilityState = {};
        columns.forEach((column) => {
          baseState[column.field] = (current[column.field] ?? true) !== false;
        });

        const mergedState =
          typeof update === "function"
            ? update(baseState)
            : { ...baseState, ...update };

        const hiddenFields = columns
          .filter((column) => mergedState[column.field] === false)
          .map((column) => column.field);

        if (columns.length - hiddenFields.length === 0) {
          return current;
        }

        const sanitized: Partial<Record<string, boolean>> = {};
        hiddenFields.forEach((field) => {
          sanitized[field] = false;
        });
        return sanitized;
      });
    },
    [columns, setColumnVisibilityModel],
  );

  const columnVisibilityState = useMemo<VisibilityState>(() => {
    const result: VisibilityState = {};
    if (!columnVisibilityModel) {
      columns.forEach((column) => {
        result[column.field] = true;
      });
      return result;
    }

    columns.forEach((column) => {
      result[column.field] =
        (columnVisibilityModel?.[column.field] ?? true) !== false;
    });

    return result;
  }, [columnVisibilityModel, columns]);

  const columnOptions = useMemo(() => {
    return columns.map((column) => ({
      field: column.field,
      label: column.headerName ?? column.field,
      visible: (columnVisibilityModel?.[column.field] ?? true) !== false,
    }));
  }, [columns, columnVisibilityModel]);

  const connRows = useMemo<ConnectionRow[]>(
    () => connections.map((each) => createConnectionRow(each)),
    [connections],
  );

  const columnDefs = useMemo<ColumnDef<ConnectionRow>[]>(() => {
    return columns.map((column) => ({
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
      cell: column.cell
        ? ({ row }) => column.cell?.(row.original)
        : (info) => info.getValue(),
    }));
  }, [columns]);

  const [sorting, setSorting] = useState<SortingState>([]);

  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnWidths((prev) => {
        const prevState = prev ?? {};
        const nextState =
          typeof updater === "function" ? updater(prevState) : updater;
        const sanitized: Record<string, number> = {};
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
    columns: columnDefs,
    state: {
      columnVisibility: columnVisibilityState,
      columnSizing: columnWidths,
      sorting,
    },
    columnResizeMode: "onChange",
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnSizingChange: handleColumnSizingChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
  });

  const rows = table.getRowModel().rows;
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
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
                          px: 1,
                          py: 1,
                          fontSize: 13,
                          fontWeight: 600,
                          color: "text.secondary",
                          userSelect: "none",
                          justifyContent:
                            meta?.align === "right" ? "flex-end" : "flex-start",
                          gap: 0.25,
                          "&:hover": {
                            backgroundColor: (theme) =>
                              theme.palette.action.hover,
                          },
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 0.5,
                            cursor: header.column.getCanSort()
                              ? "pointer"
                              : "default",
                          }}
                          onClick={header.column.getToggleSortingHandler()}
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
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
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
