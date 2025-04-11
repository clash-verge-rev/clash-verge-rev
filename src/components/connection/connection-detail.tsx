import dayjs from "dayjs";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, Snackbar, useTheme } from "@mui/material";
import { deleteConnection } from "@/services/api";
import parseTraffic from "@/utils/parse-traffic";
import { t } from "i18next";
import { RulesEditorViewer } from "@/components/profile/rules-editor-viewer";
import { useProfiles } from "@/hooks/use-profiles";
export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem) => void;
}

export const ConnectionDetail = forwardRef<ConnectionDetailRef>(
  (props, ref) => {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState<IConnectionsItem>(null!);
    const [rulesOpen, setRulesOpen] = useState(false);
    const theme = useTheme();
    
    const {
      profiles = {},
      activateSelected,
      patchProfiles,
      mutateProfiles,
    } = useProfiles();

    const groupUid = profiles.items?.find((item) => (item.type as string) === "groups")?.uid;
    const mergeUid = profiles.items?.find((item) => item.type === "merge")?.uid;
    const rules = profiles.items?.find((item) => (item.type as string) === "rules")?.uid;
    let ruleContent = detail?.metadata.host
    if (ruleContent == "") {
      ruleContent = detail?.metadata.sourceIP
    }
    useImperativeHandle(ref, () => ({
      open: (detail: IConnectionsItem) => {
        if (open) return;
        setOpen(true);
        setDetail(detail);
      },
    }));

    const onClose = () => setOpen(false);

    return (
      <Box>
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
                onClose={onClose} 
                onOpenRules={() => {
                  setRulesOpen(true);
                  onClose();
                }}
              />
            ) : null
          }
        />

        <RulesEditorViewer
          profileUid={profiles.current ?? ""}
          property={rules ?? ""}
          groupsUid={groupUid ?? ""}
          mergeUid={mergeUid ?? ""}
          open={rulesOpen}
          initialRule={ruleContent}
          onSave={() => {}}
          onClose={() => setRulesOpen(false)}
        />
      </Box>
    );
  },
);

interface InnerProps {
  data: IConnectionsItem;
  onClose?: () => void;
  onOpenRules: () => void;
}

const InnerConnectionDetail = ({ data, onClose, onOpenRules }: InnerProps) => {
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
    <Box sx={{ userSelect: "text", color: theme.palette.text.secondary }}>
      {information.map((each) => (
        <div key={each.label}>
          <b>{each.label}</b>
          <span style={{ wordBreak: "break-all", color: theme.palette.text.primary }}>: {each.value}</span>
        </div>
      ))}

      <Box sx={{ textAlign: "right", display: "flex", gap: 1, justifyContent: "flex-end" }}>
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

        <Button
          variant="contained"
          title={t("Add Rule")}
          onClick={onOpenRules}
        >
          {t("Add Rule")}
        </Button>
      </Box>
    </Box>
  );
};

