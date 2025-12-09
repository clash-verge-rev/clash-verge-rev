import { ContentCopyRounded } from "@mui/icons-material";
import { alpha, Box, Button, IconButton } from "@mui/material";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Ref } from "react";
import { useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import { BaseDialog, DialogRef } from "@/components/base";
import { getNetworkInterfacesInfo } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

export function NetworkInterfaceViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isV4, setIsV4] = useState(true);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const { data: networkInterfaces } = useSWR(
    "clash-verge-rev-internal://network-interfaces",
    getNetworkInterfacesInfo,
    {
      fallbackData: [], // default data before fetch
    },
  );

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("settings.modals.networkInterface.title")}
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
      cancelBtn={t("shared.actions.close")}
      onClose={() => setOpen(false)}
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
                        label={t(
                          "settings.modals.networkInterface.fields.ipAddress",
                        )}
                        content={address.V4.ip}
                      />
                    ),
                )}
                <AddressDisplay
                  label={t(
                    "settings.modals.networkInterface.fields.macAddress",
                  )}
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
                        label={t(
                          "settings.modals.networkInterface.fields.ipAddress",
                        )}
                        content={address.V6.ip}
                      />
                    ),
                )}
                <AddressDisplay
                  label={t(
                    "settings.modals.networkInterface.fields.macAddress",
                  )}
                  content={item.mac_addr ?? ""}
                />
              </>
            )}
          </Box>
        </Box>
      ))}
    </BaseDialog>
  );
}

const AddressDisplay = ({
  label,
  content,
}: {
  label: string;
  content: string;
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        margin: "8px 0",
      }}
    >
      <Box>{label}</Box>
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
        <Box sx={{ display: "inline", userSelect: "text" }}>{content}</Box>
        <IconButton
          size="small"
          onClick={async () => {
            await writeText(content);
            showNotice.success(
              "shared.feedback.notifications.common.copySuccess",
            );
          }}
        >
          <ContentCopyRounded sx={{ fontSize: "18px" }} />
        </IconButton>
      </Box>
    </Box>
  );
};
