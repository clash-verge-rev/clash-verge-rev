import {
  DeleteForeverRounded,
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
  TableChartRounded,
  TableRowsRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonGroup,
  Fab,
  IconButton,
  MenuItem,
  Zoom,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { closeAllConnections, closeConnection } from "tauri-plugin-mihomo-api";

import {
  BaseEmpty,
  BasePage,
  BaseSearchPanel,
  BaseStyledSelect,
  type BaseSearchPanelField,
  type SearchState,
} from "@/components/base";
import {
  ConnectionDetail,
  ConnectionDetailRef,
} from "@/components/connection/connection-detail";
import { ConnectionItem } from "@/components/connection/connection-item";
import { ConnectionTable } from "@/components/connection/connection-table";
import { useConnectionData } from "@/hooks/use-connection-data";
import { useConnectionSetting } from "@/hooks/use-connection-setting";
import parseTraffic from "@/utils/parse-traffic";

type OrderFunc = (list: IConnectionsItem[]) => IConnectionsItem[];

const ORDER_OPTIONS = [
  {
    id: "default",
    labelKey: "connections.components.order.default",
    fn: (list: IConnectionsItem[]) =>
      list.sort(
        (a, b) =>
          new Date(b.start || "0").getTime()! -
          new Date(a.start || "0").getTime()!,
      ),
  },
  {
    id: "uploadSpeed",
    labelKey: "connections.components.order.uploadSpeed",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.curUpload! - a.curUpload!),
  },
  {
    id: "downloadSpeed",
    labelKey: "connections.components.order.downloadSpeed",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.curDownload! - a.curDownload!),
  },
  {
    id: "uploadTotal",
    labelKey: "connections.components.order.uploadTotal",
    fn: (list: IConnectionsItem[]) => list.sort((a, b) => b.upload - a.upload),
  },
  {
    id: "downloadTotal",
    labelKey: "connections.components.order.downloadTotal",
    fn: (list: IConnectionsItem[]) =>
      list.sort((a, b) => b.download - a.download),
  },
  {
    id: "duration",
    labelKey: "connections.components.order.duration",
    fn: (list: IConnectionsItem[]) =>
      list.sort(
        (a, b) =>
          new Date(a.start || "0").getTime()! -
          new Date(b.start || "0").getTime()!,
      ),
  },
] as const;

type OrderKey = (typeof ORDER_OPTIONS)[number]["id"];

const orderFunctionMap = ORDER_OPTIONS.reduce<Record<OrderKey, OrderFunc>>(
  (acc, option) => {
    acc[option.id] = option.fn;
    return acc;
  },
  {} as Record<OrderKey, OrderFunc>,
);

type ConnectionFilters = {
  host: string[];
  sourceIP: string[];
  destinationIP: string[];
  network: string[];
  sourcePort: string[];
  destinationPort: string[];
};

type FilterField = keyof ConnectionFilters;

const EMPTY_FILTERS: ConnectionFilters = {
  host: [],
  sourceIP: [],
  destinationIP: [],
  network: [],
  sourcePort: [],
  destinationPort: [],
};

const normalizeFilterValue = (field: FilterField, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return field === "host" || field === "network"
    ? trimmed.toLowerCase()
    : trimmed;
};

const getUniqueValues = (values: Array<string | undefined>) => {
  const set = new Set<string>();
  values.forEach((value) => {
    const nextValue = value?.trim();
    if (nextValue) set.add(nextValue);
  });
  return [...set];
};

const ConnectionsPage = () => {
  const { t } = useTranslation();
  const [match, setMatch] = useState<(input: string) => boolean>(
    () => () => true,
  );
  const [searchState, setSearchState] = useState<SearchState>();
  const [curOrderOpt, setCurOrderOpt] = useState<OrderKey>("default");
  const [connectionsType, setConnectionsType] = useState<"active" | "closed">(
    "active",
  );
  const [filters, setFilters] = useState<ConnectionFilters>(EMPTY_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeFilterField, setActiveFilterField] =
    useState<FilterField>("sourceIP");
  const [filterQuery, setFilterQuery] = useState("");
  const [paused, setPaused] = useState(false);

  const {
    response: { data: connections },
    clearClosedConnections,
  } = useConnectionData({ paused });

  const [setting, setSetting] = useConnectionSetting();

  const isTableLayout = setting.layout === "table";

  const [isColumnManagerOpen, setIsColumnManagerOpen] = useState(false);

  const baseConnections = useMemo(
    () =>
      (connectionsType === "active"
        ? connections?.activeConnections
        : connections?.closedConnections) ?? [],
    [connections, connectionsType],
  );

  const filterOptions = useMemo(() => {
    const hosts = getUniqueValues(
      baseConnections.map(
        (conn) => conn.metadata.host || conn.metadata.remoteDestination,
      ),
    );
    const sourceIPs = getUniqueValues(
      baseConnections.map((conn) => conn.metadata.sourceIP),
    );
    const destinationIPs = getUniqueValues(
      baseConnections.map((conn) => conn.metadata.destinationIP),
    );
    const networks = getUniqueValues(
      baseConnections.map((conn) => conn.metadata.network),
    );
    const sourcePorts = getUniqueValues(
      baseConnections.map((conn) => conn.metadata.sourcePort),
    );
    const destinationPorts = getUniqueValues(
      baseConnections.map((conn) => conn.metadata.destinationPort),
    );

    return {
      host: hosts.sort((a, b) => a.localeCompare(b)),
      sourceIP: sourceIPs.sort((a, b) => a.localeCompare(b)),
      destinationIP: destinationIPs.sort((a, b) => a.localeCompare(b)),
      network: networks.sort((a, b) => a.localeCompare(b)),
      sourcePort: sourcePorts.sort((a, b) => Number(a) - Number(b)),
      destinationPort: destinationPorts.sort((a, b) => Number(a) - Number(b)),
    };
  }, [baseConnections]);

  const filterFields = useMemo<BaseSearchPanelField<FilterField>[]>(
    () => [
      {
        key: "sourceIP" as const,
        label: t("connections.components.fields.sourceIP"),
      },
      {
        key: "destinationIP" as const,
        label: t("connections.components.fields.destinationIP"),
      },
      {
        key: "host" as const,
        label: t("connections.components.fields.host"),
      },
      {
        key: "network" as const,
        label: t("connections.components.fields.network"),
      },
      {
        key: "sourcePort" as const,
        label: t("connections.components.fields.sourcePort"),
      },
      {
        key: "destinationPort" as const,
        label: t("connections.components.fields.destinationPort"),
      },
    ],
    [t],
  );

  const normalizedFilters = useMemo(
    () => ({
      host: new Set(
        filters.host.map((value) => value.trim().toLowerCase()).filter(Boolean),
      ),
      sourceIP: new Set(
        filters.sourceIP.map((value) => value.trim()).filter(Boolean),
      ),
      destinationIP: new Set(
        filters.destinationIP.map((value) => value.trim()).filter(Boolean),
      ),
      network: new Set(
        filters.network
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
      sourcePort: new Set(
        filters.sourcePort.map((value) => value.trim()).filter(Boolean),
      ),
      destinationPort: new Set(
        filters.destinationPort.map((value) => value.trim()).filter(Boolean),
      ),
    }),
    [filters],
  );

  useEffect(() => {
    setFilterQuery("");
  }, [activeFilterField]);

  const activeFieldOptions = useMemo(() => {
    const options = filterOptions[activeFilterField] ?? [];
    const selected = filters[activeFilterField] ?? [];
    const map = new Map<string, string>();
    selected.forEach((value) => {
      const normalized = normalizeFilterValue(activeFilterField, value);
      if (!normalized) return;
      map.set(normalized, value.trim());
    });
    options.forEach((value) => {
      const normalized = normalizeFilterValue(activeFilterField, value);
      if (!normalized || map.has(normalized)) return;
      map.set(normalized, value);
    });
    return Array.from(map.values());
  }, [activeFilterField, filterOptions, filters]);

  const visibleFieldOptions = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return activeFieldOptions;
    return activeFieldOptions.filter((option) =>
      option.toLowerCase().includes(query),
    );
  }, [activeFieldOptions, filterQuery]);

  const [filterConn] = useMemo(() => {
    const orderFunc = orderFunctionMap[curOrderOpt];
    let matchConns = baseConnections.filter((conn) => {
      const { metadata } = conn;
      const searchTarget = [
        metadata.host,
        metadata.destinationIP,
        metadata.remoteDestination,
        metadata.sourceIP,
        metadata.sourcePort,
        metadata.destinationPort,
        metadata.process,
        metadata.processPath,
        metadata.type,
        metadata.network,
      ]
        .filter(Boolean)
        .join(" ");

      if (!match(searchTarget)) return false;

      const hostValue = (
        metadata.host ||
        metadata.remoteDestination ||
        ""
      ).toLowerCase();
      const networkValue = (metadata.network || "").toLowerCase();
      const sourceIPValue = metadata.sourceIP || "";
      const destinationIPValue = metadata.destinationIP || "";
      const sourcePortValue = metadata.sourcePort || "";
      const destinationPortValue = metadata.destinationPort || "";

      if (
        normalizedFilters.host.size > 0 &&
        !normalizedFilters.host.has(hostValue)
      ) {
        return false;
      }
      if (
        normalizedFilters.network.size > 0 &&
        !normalizedFilters.network.has(networkValue)
      ) {
        return false;
      }
      if (
        normalizedFilters.sourceIP.size > 0 &&
        !normalizedFilters.sourceIP.has(sourceIPValue)
      ) {
        return false;
      }
      if (
        normalizedFilters.destinationIP.size > 0 &&
        !normalizedFilters.destinationIP.has(destinationIPValue)
      ) {
        return false;
      }
      if (
        normalizedFilters.sourcePort.size > 0 &&
        !normalizedFilters.sourcePort.has(sourcePortValue)
      ) {
        return false;
      }
      if (
        normalizedFilters.destinationPort.size > 0 &&
        !normalizedFilters.destinationPort.has(destinationPortValue)
      ) {
        return false;
      }

      return true;
    });

    if (orderFunc) matchConns = orderFunc(matchConns ?? []);

    return [matchConns];
  }, [baseConnections, curOrderOpt, match, normalizedFilters]);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((values) => values.length > 0),
    [filters],
  );
  const hasSearchText = Boolean(searchState?.text?.trim());
  const hasFilterCriteria = hasActiveFilters || hasSearchText;

  const onCloseAll = useLockFn(closeAllConnections);
  const onCloseFiltered = useLockFn(async () => {
    if (connectionsType !== "active" || filterConn.length === 0) return;
    if (!hasFilterCriteria) return;
    await Promise.allSettled(
      filterConn.map((conn) => closeConnection(conn.id)),
    );
  });

  const shouldCloseFiltered = connectionsType === "active" && hasFilterCriteria;
  const closeActionLabel = shouldCloseFiltered
    ? t("connections.components.actions.closeFiltered")
    : t("shared.actions.closeAll");

  const detailRef = useRef<ConnectionDetailRef>(null!);

  const isValueSelected = useCallback(
    (field: FilterField, value: string) =>
      normalizedFilters[field].has(normalizeFilterValue(field, value)),
    [normalizedFilters],
  );

  const toggleFilterValue = useCallback((field: FilterField, value: string) => {
    const normalized = normalizeFilterValue(field, value);
    if (!normalized) return;
    const trimmed = value.trim();
    setFilters((prev) => {
      const current = prev[field] ?? [];
      const next = current.filter(
        (item) => normalizeFilterValue(field, item) !== normalized,
      );
      if (next.length === current.length) {
        return { ...prev, [field]: [...current, trimmed] };
      }
      return { ...prev, [field]: next };
    });
  }, []);

  const addFilterValue = useCallback((field: FilterField, value: string) => {
    const normalized = normalizeFilterValue(field, value);
    if (!normalized) return;
    const trimmed = value.trim();
    setFilters((prev) => {
      const current = prev[field] ?? [];
      if (
        current.some((item) => normalizeFilterValue(field, item) === normalized)
      ) {
        return prev;
      }
      return { ...prev, [field]: [...current, trimmed] };
    });
  }, []);

  const handleSearch = useCallback(
    (matcher: (content: string) => boolean, state: SearchState) => {
      setMatch(() => matcher);
      setSearchState(state);
    },
    [],
  );

  const hasTableData = filterConn.length > 0;

  const handleClearFilters = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS });
  }, []);

  return (
    <BasePage
      full
      title={
        <span style={{ whiteSpace: "nowrap" }}>
          {t("connections.page.title")}
        </span>
      }
      contentStyle={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: "8px",
        minHeight: 0,
      }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ mx: 1 }}>
            {t("shared.labels.downloaded")}:{" "}
            {parseTraffic(connections?.downloadTotal)}
          </Box>
          <Box sx={{ mx: 1 }}>
            {t("shared.labels.uploaded")}:{" "}
            {parseTraffic(connections?.uploadTotal)}
          </Box>
          <IconButton
            color="inherit"
            size="small"
            title={t(paused ? "shared.actions.resume" : "shared.actions.pause")}
            aria-label={t(
              paused ? "shared.actions.resume" : "shared.actions.pause",
            )}
            onClick={() => setPaused((prev) => !prev)}
          >
            {paused ? (
              <PlayCircleOutlineRounded />
            ) : (
              <PauseCircleOutlineRounded />
            )}
          </IconButton>
          <IconButton
            color="inherit"
            size="small"
            onClick={() =>
              setSetting((o) =>
                o?.layout !== "table"
                  ? { ...o, layout: "table" }
                  : { ...o, layout: "list" },
              )
            }
          >
            {isTableLayout ? (
              <TableRowsRounded titleAccess={t("shared.actions.listView")} />
            ) : (
              <TableChartRounded titleAccess={t("shared.actions.tableView")} />
            )}
          </IconButton>
          <Button
            size="small"
            variant="contained"
            onClick={shouldCloseFiltered ? onCloseFiltered : onCloseAll}
            disabled={shouldCloseFiltered && filterConn.length === 0}
          >
            <span style={{ whiteSpace: "nowrap" }}>{closeActionLabel}</span>
          </Button>
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          minHeight: "36px",
          display: "flex",
          alignItems: "center",
          gap: 1,
          userSelect: "text",
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <ButtonGroup sx={{ mr: 1, flexBasis: "content" }}>
          <Button
            size="small"
            variant={connectionsType === "active" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("active")}
          >
            {t("connections.components.actions.active")}{" "}
            {connections?.activeConnections.length}
          </Button>
          <Button
            size="small"
            variant={connectionsType === "closed" ? "contained" : "outlined"}
            onClick={() => setConnectionsType("closed")}
          >
            {t("connections.components.actions.closed")}{" "}
            {connections?.closedConnections.length}
          </Button>
        </ButtonGroup>
        {!isTableLayout && (
          <BaseStyledSelect
            value={curOrderOpt}
            onChange={(e) => setCurOrderOpt(e.target.value as OrderKey)}
          >
            {ORDER_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                <span style={{ fontSize: 14 }}>{t(option.labelKey)}</span>
              </MenuItem>
            ))}
          </BaseStyledSelect>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <BaseSearchPanel
            open={isFilterOpen}
            onOpenChange={setIsFilterOpen}
            onSearch={handleSearch}
            filterLabel={t("connections.components.actions.filter")}
            showIndicator={hasActiveFilters}
            title={t("connections.components.actions.filter")}
            fields={filterFields.map((field) => ({
              ...field,
              count: filters[field.key].length,
            }))}
            activeField={activeFilterField}
            onActiveFieldChange={setActiveFilterField}
            options={visibleFieldOptions}
            isOptionSelected={(option) =>
              isValueSelected(activeFilterField, option)
            }
            onToggleOption={(option) =>
              toggleFilterValue(activeFilterField, option)
            }
            searchValue={filterQuery}
            onSearchValueChange={setFilterQuery}
            onSearchSubmit={(value) => {
              addFilterValue(activeFilterField, value);
              setFilterQuery("");
            }}
            searchPlaceholder={t("shared.placeholders.filter")}
            emptyText={t("shared.statuses.empty")}
            clearLabel={t("connections.components.actions.clearFilters")}
            onClear={handleClearFilters}
            clearDisabled={!hasActiveFilters}
          />
        </Box>
      </Box>

      {!hasTableData ? (
        <BaseEmpty />
      ) : isTableLayout ? (
        <ConnectionTable
          connections={filterConn}
          paused={paused}
          onShowDetail={(detail) =>
            detailRef.current?.open(detail, connectionsType === "closed")
          }
          columnManagerOpen={isTableLayout && isColumnManagerOpen}
          onOpenColumnManager={() => setIsColumnManagerOpen(true)}
          onCloseColumnManager={() => setIsColumnManagerOpen(false)}
        />
      ) : (
        <Virtuoso
          style={{
            flex: 1,
            borderRadius: "8px",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
          data={filterConn}
          itemContent={(_, item) => (
            <ConnectionItem
              value={item}
              closed={connectionsType === "closed"}
              onShowDetail={() =>
                detailRef.current?.open(item, connectionsType === "closed")
              }
            />
          )}
        />
      )}
      <ConnectionDetail ref={detailRef} />
      <Zoom
        in={connectionsType === "closed" && filterConn.length > 0}
        unmountOnExit
      >
        <Fab
          size="medium"
          variant="extended"
          sx={{
            position: "absolute",
            right: 16,
            bottom: isTableLayout ? 70 : 16,
          }}
          color="primary"
          onClick={() => clearClosedConnections()}
        >
          <DeleteForeverRounded sx={{ mr: 1 }} fontSize="small" />
          {t("shared.actions.clear")}
        </Fab>
      </Zoom>
    </BasePage>
  );
};

export default ConnectionsPage;
