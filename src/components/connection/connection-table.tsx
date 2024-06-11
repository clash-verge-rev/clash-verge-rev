import React from "react";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import {
  DataGrid,
  GridColDef,
  GridActionsCellItem,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
} from "@mui/x-data-grid";
import { truncateStr } from "@/utils/truncate-str";
import parseTraffic from "@/utils/parse-traffic";
import { useTranslation } from "react-i18next";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { zhCN, enUS } from "@mui/x-data-grid/locales";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import CancelIcon from "@mui/icons-material/Close";
import { deleteConnection } from "@/services/api";

interface Props {
  connections: IConnectionsItem[];
  onShowDetail: (data: IConnectionsItem) => void;
}

export const ConnectionTable = (props: Props) => {
  const { t, i18n } = useTranslation();
  const { connections, onShowDetail } = props;

  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const themeWithLocale = React.useMemo(() => {
    switch (i18n.language) {
      case "zh":
        return createTheme(theme, zhCN);
      default:
        return createTheme(theme, enUS);
    }
  }, [theme]);

  const Toolbar = () => (
    <div style={{ margin: "5px" }}>
      <GridToolbarColumnsButton />
      <GridToolbarFilterButton />
    </div>
  );

  const [columnVisible, setColumnVisible] = useState<
    Partial<Record<keyof IConnectionsItem, boolean>>
  >({});

  const columns: GridColDef[] = [
    {
      field: "actions",
      type: "actions",
      headerName: `${t("Actions")}`,
      width: 50,
      cellClassName: "actions",
      getActions: ({ id }) => {
        return [
          <GridActionsCellItem
            icon={<CancelIcon />}
            label="Cancel"
            className="textPrimary"
            onClick={() => deleteConnection(id.toString())}
            color="inherit"
          />,
        ];
      },
    },
    { field: "host", headerName: t("Host"), flex: 220, minWidth: 220 },
    {
      field: "upload",
      headerName: t("Uploaded"),
      width: 88,
      align: "center",
      headerAlign: "center",
      valueFormatter: (value) => parseTraffic(value).join(" "),
    },
    {
      field: "download",
      headerName: t("Download"),
      width: 88,
      align: "center",
      headerAlign: "center",
      valueFormatter: (value) => parseTraffic(value).join(" "),
    },
    {
      field: "ulSpeed",
      headerName: t("UL Speed"),
      width: 120,
      align: "center",
      headerAlign: "center",
      valueFormatter: (value) => parseTraffic(value).join(" ") + "/s",
    },
    {
      field: "dlSpeed",
      headerName: t("DL Speed"),
      width: 120,
      align: "center",
      headerAlign: "center",
      valueFormatter: (value) => parseTraffic(value).join(" ") + "/s",
    },
    { field: "chains", headerName: t("Chains"), flex: 360, minWidth: 360 },
    { field: "rule", headerName: t("Rule"), flex: 300, minWidth: 250 },
    {
      field: "process",
      headerName: t("Process"),
      flex: 240,
      minWidth: 120,
    },
    {
      field: "time",
      headerName: t("Time"),
      flex: 120,
      minWidth: 100,
      align: "right",
      headerAlign: "right",
      sortComparator: (v1, v2) => {
        return new Date(v2).getTime() - new Date(v1).getTime();
      },
      valueFormatter: (value) => dayjs(value).fromNow(),
    },
    { field: "source", headerName: t("Source"), flex: 200, minWidth: 130 },
    {
      field: "destinationIP",
      headerName: t("Destination IP"),
      flex: 200,
      minWidth: 130,
    },
    { field: "type", headerName: t("Type"), flex: 160, minWidth: 100 },
  ];

  const connRows = useMemo(() => {
    return connections.map((each) => {
      const { metadata, rulePayload } = each;
      const chains = [...each.chains].reverse().join(" / ");
      const rule = rulePayload ? `${each.rule}(${rulePayload})` : each.rule;
      return {
        id: each.id,
        host: metadata.host
          ? `${metadata.host}:${metadata.destinationPort}`
          : `${metadata.destinationIP}:${metadata.destinationPort}`,
        download: each.download,
        upload: each.upload,
        dlSpeed: each.curDownload,
        ulSpeed: each.curUpload,
        chains,
        rule,
        process: truncateStr(metadata.process || metadata.processPath),
        time: each.start,
        source: `${metadata.sourceIP}:${metadata.sourcePort}`,
        destinationIP: metadata.destinationIP,
        type: `${metadata.type}(${metadata.network})`,

        connectionData: each,
      };
    });
  }, [connections]);

  return (
    <ThemeProvider theme={themeWithLocale}>
      <DataGrid
        hideFooter
        disableDensitySelector
        disableColumnMenu
        rows={connRows}
        columns={columns}
        slots={{ toolbar: Toolbar }}
        onRowClick={(e) => onShowDetail(e.row.connectionData)}
        density="compact"
        sx={{
          border: "none",
          "div:focus": { outline: "none !important" },
          "& .MuiDataGrid-container--top .MuiDataGrid-columnHeader": {
            backgroundColor: isDark ? "#282a36" : "#ffffff",
          },
        }}
        columnVisibilityModel={columnVisible}
        onColumnVisibilityModelChange={(e) => setColumnVisible(e)}
      />
    </ThemeProvider>
  );
};
