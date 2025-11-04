import { Box, Button, Snackbar, useTheme } from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useImperativeHandle, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { closeConnections } from "tauri-plugin-mihomo-api";

import parseTraffic from "@/utils/parse-traffic";

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem) => void;
}

export function ConnectionDetail({ ref }: { ref?: Ref<ConnectionDetailRef> }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<IConnectionsItem>(null!);
  const theme = useTheme();

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
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
        },
      }}
      message={
        detail ? (
          <InnerConnectionDetail data={detail} onClose={onClose} />
        ) : null
      }
    />
  );
}

interface InnerProps {
  data: IConnectionsItem;
  onClose?: () => void;
}

const InnerConnectionDetail = ({ data, onClose }: InnerProps) => {
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
    { label: t("entities.connection.fields.host"), value: host },
    {
      label: t("entities.connection.fields.downloaded"),
      value: parseTraffic(data.download).join(" "),
    },
    {
      label: t("entities.connection.fields.uploaded"),
      value: parseTraffic(data.upload).join(" "),
    },
    {
      label: t("entities.connection.fields.dlSpeed"),
      value: parseTraffic(data.curDownload ?? -1).join(" ") + "/s",
    },
    {
      label: t("entities.connection.fields.ulSpeed"),
      value: parseTraffic(data.curUpload ?? -1).join(" ") + "/s",
    },
    {
      label: t("entities.connection.fields.chains"),
      value: chains,
    },
    { label: t("entities.connection.fields.rule"), value: rule },
    {
      label: t("entities.connection.fields.process"),
      value: `${metadata.process}${metadata.processPath ? `(${metadata.processPath})` : ""}`,
    },
    {
      label: t("entities.connection.fields.time"),
      value: dayjs(data.start).fromNow(),
    },
    {
      label: t("entities.connection.fields.source"),
      value: `${metadata.sourceIP}:${metadata.sourcePort}`,
    },
    {
      label: t("entities.connection.fields.destination"),
      value: Destination,
    },
    {
      label: t("entities.connection.fields.destinationPort"),
      value: `${metadata.destinationPort}`,
    },
    {
      label: t("entities.connection.fields.type"),
      value: `${metadata.type}(${metadata.network})`,
    },
  ];

  const onDelete = useLockFn(async () => closeConnections(data.id));

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

      <Box sx={{ textAlign: "right" }}>
        <Button
          variant="contained"
          title={t("entities.connection.actions.closeConnection")}
          onClick={() => {
            onDelete();
            onClose?.();
          }}
        >
          {t("entities.connection.actions.closeConnection")}
        </Button>
      </Box>
    </Box>
  );
};
