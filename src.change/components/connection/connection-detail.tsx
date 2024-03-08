import dayjs from "dayjs";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, Snackbar } from "@mui/material";
import { deleteConnection } from "@/services/api";
import { truncateStr } from "@/utils/truncate-str";
import parseTraffic from "@/utils/parse-traffic";

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem) => void;
}

export const ConnectionDetail = forwardRef<ConnectionDetailRef>(
  (props, ref) => {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<IConnectionsItem>(null!);

    useImperativeHandle(ref, () => ({
      open: (detail: IConnectionsItem) => {
        if (open) return;
        setOpen(true);
        setDetail(detail);
      },
    }));

    const onClose = () => setOpen(false);

    return (
      <Snackbar
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        open={open}
        onClose={onClose}
        message={
          detail ? (
            <InnerConnectionDetail data={detail} onClose={onClose} />
          ) : null
        }
      />
    );
  }
);

interface InnerProps {
  data: IConnectionsItem;
  onClose?: () => void;
}

const InnerConnectionDetail = ({ data, onClose }: InnerProps) => {
  const { metadata, rulePayload } = data;
  const chains = [...data.chains].reverse().join(" / ");
  const rule = rulePayload ? `${data.rule}(${rulePayload})` : data.rule;
  const host = metadata.host
    ? `${metadata.host}:${metadata.destinationPort}`
    : `${metadata.destinationIP}:${metadata.destinationPort}`;

  const information = [
    { label: "Host", value: host },
    { label: "Download", value: parseTraffic(data.download).join(" ") },
    { label: "Upload", value: parseTraffic(data.upload).join(" ") },
    {
      label: "DL Speed",
      value: parseTraffic(data.curDownload ?? -1).join(" ") + "/s",
    },
    {
      label: "UL Speed",
      value: parseTraffic(data.curUpload ?? -1).join(" ") + "/s",
    },
    { label: "Chains", value: chains },
    { label: "Rule", value: rule },
    {
      label: "Process",
      value: truncateStr(metadata.process || metadata.processPath),
    },
    { label: "Time", value: dayjs(data.start).fromNow() },
    { label: "Source", value: `${metadata.sourceIP}:${metadata.sourcePort}` },
    { label: "Destination IP", value: metadata.destinationIP },
    { label: "Type", value: `${metadata.type}(${metadata.network})` },
  ];

  const onDelete = useLockFn(async () => deleteConnection(data.id));

  return (
    <Box sx={{ userSelect: "text" }}>
      {information.map((each) => (
        <div key={each.label}>
          <b>{each.label}</b>: <span>{each.value}</span>
        </div>
      ))}

      <Box sx={{ textAlign: "right" }}>
        <Button
          variant="contained"
          title="Close Connection"
          onClick={() => {
            onDelete();
            onClose?.();
          }}
        >
          Close
        </Button>
      </Box>
    </Box>
  );
};
