import dayjs from "dayjs";
import { useMemo } from "react";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import parseTraffic from "@/utils/parse-traffic";

interface Props {
  connections: IConnectionsItem[];
}

const ConnectionTable = (props: Props) => {
  const { connections } = props;

  const columns: GridColDef[] = [
    {
      field: "host",
      headerName: "Host",
      flex: 200,
      minWidth: 200,
      resizable: false,
      disableColumnMenu: true,
    },
    {
      field: "download",
      headerName: "Download",
      width: 88,
      align: "right",
      headerAlign: "right",
      disableColumnMenu: true,
      valueFormatter: (params: any) => parseTraffic(params.value).join(" "),
    },
    {
      field: "upload",
      headerName: "Upload",
      width: 88,
      align: "right",
      headerAlign: "right",
      disableColumnMenu: true,
      valueFormatter: (params: any) => parseTraffic(params.value).join(" "),
    },
    {
      field: "dlSpeed",
      headerName: "DL Speed",
      align: "right",
      width: 88,
      headerAlign: "right",
      disableColumnMenu: true,
      valueFormatter: (params: any) =>
        parseTraffic(params.value).join(" ") + "/s",
    },
    {
      field: "ulSpeed",
      headerName: "UL Speed",
      width: 88,
      align: "right",
      headerAlign: "right",
      disableColumnMenu: true,
      valueFormatter: (params: any) =>
        parseTraffic(params.value).join(" ") + "/s",
    },
    {
      field: "chains",
      headerName: "Chains",
      width: 360,
      disableColumnMenu: true,
    },
    {
      field: "rule",
      headerName: "Rule",
      width: 225,
      disableColumnMenu: true,
    },
    {
      field: "process",
      headerName: "Process",
      width: 120,
      disableColumnMenu: true,
    },
    {
      field: "time",
      headerName: "Time",
      width: 120,
      align: "right",
      headerAlign: "right",
      disableColumnMenu: true,
      valueFormatter: (params) => dayjs(params.value).fromNow(),
    },
    {
      field: "source",
      headerName: "Source",
      width: 150,
      disableColumnMenu: true,
    },
    {
      field: "destinationIP",
      headerName: "Destination IP",
      width: 125,
      disableColumnMenu: true,
    },
    {
      field: "type",
      headerName: "Type",
      width: 160,
      disableColumnMenu: true,
    },
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
        process: metadata.process || metadata.processPath,
        time: each.start,
        source: `${metadata.sourceIP}:${metadata.sourcePort}`,
        destinationIP: metadata.destinationIP,
        type: `${metadata.type}(${metadata.network})`,
      };
    });
  }, [connections]);

  return (
    <DataGrid
      rows={connRows}
      columns={columns}
      density="compact"
      sx={{ border: "none", "div:focus": { outline: "none !important" } }}
      hideFooter
    />
  );
};

export default ConnectionTable;
