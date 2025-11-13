import { Box, Button, Snackbar, useTheme } from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useImperativeHandle, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { closeConnection } from "tauri-plugin-mihomo-api";

import parseTraffic from "@/utils/parse-traffic";

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem, closed: boolean) => void;
}

export function ConnectionDetail({ ref }: { ref?: Ref<ConnectionDetailRef> }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<IConnectionsItem>(null!);
  const [closed, setClosed] = useState(false);
  const theme = useTheme();

  useImperativeHandle(ref, () => ({
    open: (detail: IConnectionsItem, closed: boolean) => {
      if (open) return;
      setOpen(true);
      setDetail(detail);
      setClosed(closed);
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
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
        },
      }}
      message={
        detail ? (
          <InnerConnectionDetail
            data={detail}
            closed={closed}
            onClose={onClose}
          />
        ) : null
      }
    />
  );
}

interface InnerProps {
  data: IConnectionsItem;
  closed: boolean;
  onClose?: () => void;
}

const InnerConnectionDetail = ({ data, closed, onClose }: InnerProps) => {
  const { t } = useTranslation();
  const { metadata, rulePayload } = data;
  const theme = useTheme();
  const chains = [...data.chains].reverse().join(" / ");
  const rule = rulePayload ? `${data.rule}(${rulePayload})` : data.rule;
  const host = metadata.host
    ? `${metadata.host}:${metadata.destinationPort}`
    : `${metadata.remoteDestination}:${metadata.destinationPort}`;
  const Destination = metadata.destinationIP
    ? metadata.destinationIP
    : metadata.remoteDestination;

  const information = [
    { label: t("connections.components.fields.host"), value: host },
    {
      label: t("shared.labels.downloaded"),
      value: parseTraffic(data.download).join(" "),
    },
    {
      label: t("shared.labels.uploaded"),
      value: parseTraffic(data.upload).join(" "),
    },
    {
      label: t("connections.components.fields.dlSpeed"),
      value: parseTraffic(data.curDownload ?? -1).join(" ") + "/s",
    },
    {
      label: t("connections.components.fields.ulSpeed"),
      value: parseTraffic(data.curUpload ?? -1).join(" ") + "/s",
    },
    {
      label: t("connections.components.fields.chains"),
      value: chains,
    },
    { label: t("connections.components.fields.rule"), value: rule },
    {
      label: t("connections.components.fields.process"),
      value: `${metadata.process}${metadata.processPath ? `(${metadata.processPath})` : ""}`,
    },
    {
      label: t("connections.components.fields.time"),
      value: dayjs(data.start).fromNow(),
    },
    {
      label: t("connections.components.fields.source"),
      value: `${metadata.sourceIP}:${metadata.sourcePort}`,
    },
    {
      label: t("connections.components.fields.destination"),
      value: Destination,
    },
    {
      label: t("connections.components.fields.destinationPort"),
      value: `${metadata.destinationPort}`,
    },
    {
      label: t("connections.components.fields.type"),
      value: `${metadata.type}(${metadata.network})`,
    },
  ];

  const onDelete = useLockFn(async () => closeConnection(data.id));

  return (
    <Box sx={{ userSelect: "text", color: theme.palette.text.secondary }}>
      {information.map((each) => (
        <div key={each.label}>
          <b>{each.label}</b>
          <span
            style={{
              wordBreak: "break-all",
              color: theme.palette.text.primary,
            }}
          >
            : {each.value}
          </span>
        </div>
      ))}

      {!closed && (
        <Box sx={{ textAlign: "right" }}>
          <Button
            variant="contained"
            title={t("connections.components.actions.closeConnection")}
            onClick={() => {
              onDelete();
              onClose?.();
            }}
          >
            {t("connections.components.actions.closeConnection")}
          </Button>
        </Box>
      )}
    </Box>
  );
};
