import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Snackbar } from "@mui/material";
import parseTraffic from "@/utils/parse-traffic";

interface Props {
  connections: IConnectionsItem[];
}

const ConnectionTable = (props: Props) => {
  const { connections } = props;

  const [openedDetail, setOpenedDetail] = useState<IConnectionsItem | null>(
    null
  );

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
      width: 480,
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
        process: truncateStr(
          metadata.process || metadata.processPath || "",
          16,
          56
        ),
        time: each.start,
        source: `${metadata.sourceIP}:${metadata.sourcePort}`,
        destinationIP: metadata.destinationIP,
        type: `${metadata.type}(${metadata.network})`,

        connectionData: each,
      };
    });
  }, [connections]);

  return (
    <>
      <DataGrid
        rows={connRows}
        columns={columns}
        onRowClick={(e) => setOpenedDetail(e.row.connectionData)}
        density="compact"
        sx={{ border: "none", "div:focus": { outline: "none !important" } }}
        hideFooter
      />
      <Snackbar
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        open={Boolean(openedDetail)}
        onClose={() => setOpenedDetail(null)}
        message={
          openedDetail ? <SingleConnectionDetail data={openedDetail} /> : null
        }
      />
    </>
  );
};

export default ConnectionTable;

const truncateStr = (str: string, prefixLen: number, maxLen: number) => {
  if (str.length <= maxLen) return str;
  return (
    str.slice(0, prefixLen) + " ... " + str.slice(-(maxLen - prefixLen - 5))
  );
};

const SingleConnectionDetail = ({ data }: { data: IConnectionsItem }) => {
  const { metadata, rulePayload } = data;
  const chains = [...data.chains].reverse().join(" / ");
  const rule = rulePayload ? `${data.rule}(${rulePayload})` : data.rule;
  const host = metadata.host
    ? `${metadata.host}:${metadata.destinationPort}`
    : `${metadata.destinationIP}:${metadata.destinationPort}`;

  return (
    <div>
      <div>
        {" "}
        <b>Host</b>: <span>{host}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Download</b>: <span>{parseTraffic(data.download).join(" ")}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Upload</b>: <span>{parseTraffic(data.upload).join(" ")}</span>{" "}
      </div>
      <div>
        {" "}
        <b>DL Speed</b>:{" "}
        <span>{parseTraffic(data.curDownload ?? -1).join(" ") + "/s"}</span>{" "}
      </div>
      <div>
        {" "}
        <b>UL Speed</b>:{" "}
        <span>{parseTraffic(data.curUpload ?? -1).join(" ") + "/s"}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Chains</b>: <span>{chains}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Rule</b>: <span>{rule}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Process</b>: <span>{metadata.process}</span>{" "}
      </div>
      <div>
        {" "}
        <b>ProcessPath</b>: <span>{metadata.processPath}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Time</b>: <span>{dayjs(data.start).fromNow()}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Source</b>:{" "}
        <span>{`${metadata.sourceIP}:${metadata.sourcePort}`}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Destination IP</b>: <span>{metadata.destinationIP}</span>{" "}
      </div>
      <div>
        {" "}
        <b>Type</b>: <span>{`${metadata.type}(${metadata.network})`}</span>{" "}
      </div>
    </div>
  );
};
