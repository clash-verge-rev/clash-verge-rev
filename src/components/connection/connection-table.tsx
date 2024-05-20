import dayjs from "dayjs";
import { useMemo, useState } from "react";
import {
  DataGrid,
  GridColDef,
  GridValueFormatterParams,
} from "@mui/x-data-grid";
import { truncateStr } from "@/utils/truncate-str";
import parseTraffic from "@/utils/parse-traffic";
import { t } from "i18next";

interface Props {
  connections: IConnectionsItem[];
  onShowDetail: (data: IConnectionsItem) => void;
}

export const ConnectionTable = (props: Props) => {
  const { connections, onShowDetail } = props;

  const [columnVisible, setColumnVisible] = useState<
    Partial<Record<keyof IConnectionsItem, boolean>>
  >({});

  const columns: GridColDef[] = [
    { field: "host", headerName: t("Host"), flex: 220, minWidth: 220 },
    {
      field: "download",
      headerName: t("Downloaded"),
      width: 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (params: GridValueFormatterParams<number>) =>
        parseTraffic(params.value).join(" "),
    },
    {
      field: "upload",
      headerName: t("Uploaded"),
      width: 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (params: GridValueFormatterParams<number>) =>
        parseTraffic(params.value).join(" "),
    },
    {
      field: "dlSpeed",
      headerName: t("DL Speed"),
      width: 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (params: GridValueFormatterParams<number>) =>
        parseTraffic(params.value).join(" ") + "/s",
    },
    {
      field: "ulSpeed",
      headerName: t("UL Speed"),
      width: 88,
      align: "right",
      headerAlign: "right",
      valueFormatter: (params: GridValueFormatterParams<number>) =>
        parseTraffic(params.value).join(" ") + "/s",
    },
    { field: "chains", headerName: t("Chains"), flex: 360, minWidth: 360 },
    { field: "rule", headerName: t("Rule"), flex: 300, minWidth: 250 },
    { field: "process", headerName: t("Process"), flex: 240, minWidth: 120 },
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
      valueFormatter: (params: GridValueFormatterParams<string>) =>
        dayjs(params.value).fromNow(),
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
    <DataGrid
      hideFooter
      rows={connRows}
      columns={columns}
      onRowClick={(e) => onShowDetail(e.row.connectionData)}
      density="compact"
      sx={{ border: "none", "div:focus": { outline: "none !important" } }}
      columnVisibilityModel={columnVisible}
      onColumnVisibilityModelChange={(e) => setColumnVisible(e)}
    />
  );
};
