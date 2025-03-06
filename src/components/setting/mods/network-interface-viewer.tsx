import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { getNetworkInterfacesInfo } from "@/services/cmds";
import { alpha, Box, Button, Chip, IconButton } from "@mui/material";
import { ContentCopyRounded } from "@mui/icons-material";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export const NetworkInterfaceViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState<
    INetworkInterface[]
  >([]);
  const [isV4, setIsV4] = useState(true);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  useEffect(() => {
    if (!open) return;
    getNetworkInterfacesInfo().then((res) => {
      setNetworkInterfaces(res);
    });
  }, [open]);

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("Network Interface")}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                setIsV4((prev) => !prev);
              }}
            >
              {isV4 ? "Ipv6" : "Ipv4"}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t("Close")}
      onCancel={() => setOpen(false)}
    >
      {networkInterfaces.map((item) => (
        <Box key={item.name}>
          <h4>{item.name}</h4>
          <Box>
            {isV4 && (
              <>
                {item.addr.map(
                  (address) =>
                    address.V4 && (
                      <AddressDisplay
                        key={address.V4.ip}
                        label={t("Ip Address")}
                        content={address.V4.ip}
                      />
                    ),
                )}
                <AddressDisplay
                  label={t("Mac Address")}
                  content={item.mac_addr ?? ""}
                />
              </>
            )}
            {!isV4 && (
              <>
                {item.addr.map(
                  (address) =>
                    address.V6 && (
                      <AddressDisplay
                        key={address.V6.ip}
                        label={t("Ip Address")}
                        content={address.V6.ip}
                      />
                    ),
                )}
                <AddressDisplay
                  label={t("Mac Address")}
                  content={item.mac_addr ?? ""}
                />
              </>
            )}
          </Box>
        </Box>
      ))}
    </BaseDialog>
  );
});

const AddressDisplay = (props: { label: string; content: string }) => {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        margin: "8px 0",
      }}
    >
      <Box>{props.label}</Box>
      <Box
        sx={({ palette }) => ({
          borderRadius: "8px",
          padding: "2px 2px 2px 8px",
          background:
            palette.mode === "dark"
              ? alpha(palette.background.paper, 0.3)
              : alpha(palette.grey[400], 0.3),
        })}
      >
        <Box sx={{ display: "inline", userSelect: "text" }}>
          {props.content}
        </Box>
        <IconButton
          size="small"
          onClick={async () => {
            await writeText(props.content);
            Notice.success(t("Copy Success"));
          }}
        >
          <ContentCopyRounded sx={{ fontSize: "18px" }} />
        </IconButton>
      </Box>
    </Box>
  );
};
