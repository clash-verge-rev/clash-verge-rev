import dayjs from "dayjs";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, Snackbar } from "@mui/material";
import { deleteConnection } from "@/services/api";
import parseTraffic from "@/utils/parse-traffic";
import { t } from "i18next";

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
        sx={{
          ".MuiSnackbarContent-root": {
            maxWidth: "520px",
            maxHeight: "480px",
            overflowY: "auto",
          },
        }}
        message={
          detail ? (
            <InnerConnectionDetail data={detail} onClose={onClose} />
          ) : null
        }
      />
    );
  },
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
    : `${metadata.remoteDestination}:${metadata.destinationPort}`;
  const Destination = metadata.destinationIP
    ? metadata.destinationIP
    : metadata.remoteDestination;

  const information = [
    { label: t("Host"), value: host },
    { label: t("Downloaded"), value: parseTraffic(data.download).join(" ") },
    { label: t("Uploaded"), value: parseTraffic(data.upload).join(" ") },
    {
      label: t("DL Speed"),
      value: parseTraffic(data.curDownload ?? -1).join(" ") + "/s",
    },
    {
      label: t("UL Speed"),
      value: parseTraffic(data.curUpload ?? -1).join(" ") + "/s",
    },
    {
      label: t("Chains"),
      value: chains,
    },
    { label: t("Rule"), value: rule },
    {
      label: t("Process"),
      value: `${metadata.process}${
        metadata.processPath ? `(${metadata.processPath})` : ""
      }`,
    },
    { label: t("Time"), value: dayjs(data.start).fromNow() },
    {
      label: t("Source"),
      value: `${metadata.sourceIP}:${metadata.sourcePort}`,
    },
    { label: t("Destination"), value: Destination },
    { label: t("DestinationPort"), value: `${metadata.destinationPort}` },
    { label: t("Type"), value: `${metadata.type}(${metadata.network})` },
  ];

  const onDelete = useLockFn(async () => deleteConnection(data.id));

  return (
    <Box sx={{ userSelect: "text" }}>
      {information.map((each) => (
        <div key={each.label}>
          <b>{each.label}</b>
          <span style={{ wordBreak: "break-all" }}>: {each.value}</span>
        </div>
      ))}

      <Box sx={{ textAlign: "right" }}>
        <Button
          variant="contained"
          title={t("Close Connection")}
          onClick={() => {
            onDelete();
            onClose?.();
          }}
        >
          {t("Close Connection")}
        </Button>
      </Box>
    </Box>
  );
};
