import parseTraffic from "@/utils/parse-traffic";
import { Box, Button, Snackbar } from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { closeConnections } from "tauri-plugin-mihomo-api";

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem, active: boolean) => void;
}

export const ConnectionDetail = forwardRef<ConnectionDetailRef>(
  (props, ref) => {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<IConnectionsItem>();
    const [active, setActive] = useState(true);

    useImperativeHandle(ref, () => ({
      open: (detail: IConnectionsItem, active) => {
        if (open) return;
        setOpen(true);
        setDetail(detail);
        setActive(active);
      },
    }));

    const onClose = () => setOpen(false);

    return (
      <Snackbar
        autoHideDuration={6000}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        open={open}
        onClose={onClose}
        message={
          detail ? (
            <InnerConnectionDetail
              data={detail}
              active={active}
              onClose={onClose}
            />
          ) : null
        }
      />
    );
  },
);

interface InnerProps {
  data: IConnectionsItem;
  active: boolean;
  onClose?: () => void;
}

const InnerConnectionDetail = ({ data, active, onClose }: InnerProps) => {
  const { t } = useTranslation();
  const { metadata, rulePayload } = data;
  const chains = [...data.chains].reverse().join(" / ");
  const rule = rulePayload ? `${data.rule}(${rulePayload})` : data.rule;
  const host = metadata.host
    ? `${metadata.host}:${metadata.destinationPort}`
    : `${metadata.destinationIP}:${metadata.destinationPort}`;

  const information = [
    { label: t("Type"), value: `${metadata.type}(${metadata.network})` },
    { label: t("Host"), value: host },
    { label: t("Downloaded"), value: parseTraffic(data.download).join(" ") },
    { label: t("Uploaded"), value: parseTraffic(data.upload).join(" ") },
    {
      label: t("DL Speed"),
      value: `${parseTraffic(data.curDownload ?? -1).join(" ")}/s`,
    },
    {
      label: t("UL Speed"),
      value: `${parseTraffic(data.curUpload ?? -1).join(" ")}/s`,
    },
    { label: t("Chains"), value: chains },
    { label: t("Rule"), value: rule },
    {
      label: t("Process"),
      value: `${metadata.process}${
        metadata.processPath ? `(${metadata.processPath})` : ""
      }`,
    },
    {
      label: t("Source"),
      value: `${metadata.sourceIP}:${metadata.sourcePort}`,
    },
    { label: t("Destination IP"), value: metadata.destinationIP },
    { label: t("Time"), value: dayjs(data.start).fromNow() },
  ];

  const onDelete = useLockFn(async () => closeConnections(data.id));

  return (
    <Box sx={{ userSelect: "text", maxWidth: 500, minWidth: 300 }}>
      {information.map((each) => (
        <div key={each.label} className="flex w-full break-all">
          <div className="text-primary-main w-fit min-w-[102px] shrink-0 grow-0 pr-2 text-right font-bold">
            {each.label}
          </div>
          <div className="grow">{each.value}</div>
        </div>
      ))}

      {active && (
        <Box sx={{ textAlign: "right" }}>
          <Button
            variant="contained"
            title={t("Close Connection")}
            onClick={() => {
              onDelete();
              onClose?.();
            }}>
            {t("Close Connection")}
          </Button>
        </Box>
      )}
    </Box>
  );
};
