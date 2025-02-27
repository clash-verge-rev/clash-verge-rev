import dayjs from "dayjs";
import { useMemo, useState, useEffect } from "react";
import { DataGrid, GridColDef, GridColumnResizeParams } from "@mui/x-data-grid";
import { useThemeMode } from "@/services/states";
import { truncateStr } from "@/utils/truncate-str";
import parseTraffic from "@/utils/parse-traffic";
import { t } from "i18next";

interface Props {
  connections: IConnectionsItem[];
  onShowDetail: (data: IConnectionsItem) => void;
}

export const ConnectionTable = (props: Props) => {
  const { connections, onShowDetail } = props;
  const mode = useThemeMode();
  const isDark = mode === "light" ? false : true;
  const backgroundColor = isDark ? "#282A36" : "#ffffff";

  const [columnVisible, setColumnVisible] = useState<
    Partial<Record<keyof IConnectionsItem, boolean>>
  >({});

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => {
      const saved = localStorage.getItem("connection-table-widths");
      return saved ? JSON.parse(saved) : {};
    },
  );

  const [columns] = useState<GridColDef[]>([
    {
      field: "host",
      headerName: t("Host"),
      width: columnWidths["host"] || 220,
      minWidth: 180,
    },
    {
      field: "download",
      headerName: t("Downloaded"),
      width: columnWidths["download"] || 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: number) => parseTraffic(value).join(" "),
    },
    {
      field: "upload",
      headerName: t("Uploaded"),
      width: columnWidths["upload"] || 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: number) => parseTraffic(value).join(" "),
    },
    {
      field: "dlSpeed",
      headerName: t("DL Speed"),
      width: columnWidths["dlSpeed"] || 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
    },
    {
      field: "ulSpeed",
      headerName: t("UL Speed"),
      width: columnWidths["ulSpeed"] || 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (value: number) => parseTraffic(value).join(" ") + "/s",
    },
    {
      field: "chains",
      headerName: t("Chains"),
      width: columnWidths["chains"] || 340,
      minWidth: 180,
    },
    {
      field: "rule",
      headerName: t("Rule"),
      width: columnWidths["rule"] || 280,
      minWidth: 180,
    },
    {
      field: "process",
      headerName: t("Process"),
      width: columnWidths["process"] || 220,
      minWidth: 180,
    },
    {
      field: "time",
      headerName: t("Time"),
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
      headerName: t("Source"),
      width: columnWidths["source"] || 200,
      minWidth: 130,
    },
    {
      field: "remoteDestination",
      headerName: t("Destination"),
      width: columnWidths["remoteDestination"] || 200,
      minWidth: 130,
    },
    {
      field: "type",
      headerName: t("Type"),
      width: columnWidths["type"] || 160,
      minWidth: 100,
    },
  ]);

  useEffect(() => {
    console.log("Saving column widths:", columnWidths);
    localStorage.setItem(
      "connection-table-widths",
      JSON.stringify(columnWidths),
    );
  }, [columnWidths]);

  const handleColumnResize = (params: GridColumnResizeParams) => {
    const { colDef, width } = params;
    console.log("Column resize:", colDef.field, width);
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
