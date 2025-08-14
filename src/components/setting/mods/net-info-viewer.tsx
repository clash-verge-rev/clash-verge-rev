import { BaseDialog, CopyButton, DialogRef } from "@/components/base";
import { getNetInfo } from "@/services/cmds";
import { Typography } from "@mui/material";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export const NetInfoViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [netInfo, setNetInfo] = useState<NetInfo[]>([]);

  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true);
      let netInfo = await getNetInfo();
      setNetInfo(netInfo);
    },
    close: () => setOpen(false),
  }));

  return (
    <BaseDialog
      open={open}
      title={t("Network Interface Info")}
      contentStyle={{
        width: 450,
        overflowY: "auto",
        userSelect: "text",
      }}
      hideOkBtn
      hideCancelBtn
      onClose={() => setOpen(false)}>
      <>
        {netInfo.map((net) => {
          return (
            <div key={net.name} className="w-full py-2">
              <h3 className="border-primary bg-primary-alpha inline-block w-full border-l-4 pl-2 font-bold">
                {net.name}
              </h3>
              {net.ipv4 && (
                <div className="flex items-center pl-2">
                  <div className="flex w-full items-center justify-between pl-2">
                    <Typography variant="subtitle2">IPv4</Typography>
                    <Typography>{net.ipv4}</Typography>
                  </div>
                  <CopyButton size="small" content={net.ipv4} />
                </div>
              )}
              {net.ipv6 && (
                <div className="flex items-center pl-2">
                  <div className="flex w-full items-center justify-between pl-2">
                    <Typography variant="subtitle2">IPv6</Typography>
                    <Typography>{net.ipv6}</Typography>
                  </div>
                  <CopyButton size="small" content={net.ipv6} />
                </div>
              )}
            </div>
          );
        })}
      </>
    </BaseDialog>
  );
});
