import { BaseDialog, Switch } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import { Divider, Box, Typography } from "@mui/material";
import { useLockFn, useRequest } from "ahooks";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

interface ClashBindingProps {}

interface ClashBindingRef {
  open: () => void;
  close: () => void;
}

export const Profile = forwardRef<ClashBindingRef, ClashBindingProps>(
  (props, ref) => {
    const { t } = useTranslation();
    const { clash, mutateClash, patchClash } = useClash();
    const [open, setOpen] = useState(false);

    // 配置状态管理
    const [config, setConfig] = useState<IConfigData["profile"]>({
      "store-selected": true,
      "store-fake-ip": true,
    });

    // 保存配置请求
    const { loading, run: saveConfig } = useRequest(
      async (config: IConfigData["profile"]) => {
        await patchClash({ profile: config });
        await mutateClash();
      },
      {
        manual: true,
        onSuccess: () => {
          setOpen(false);
          showNotice("success", t("Configuration saved"));
        },
        onError: () => {
          showNotice("error", t("Failed to save configuration"));
        },
      },
    );

    // 监听clash数据变化，更新本地配置状态
    useEffect(() => {
      if (clash && clash.profile) {
        setConfig({
          "store-selected": clash.profile["store-selected"],
          "store-fake-ip": clash.profile["store-fake-ip"],
        });
      }
    }, [clash]);

    useImperativeHandle(ref, () => ({
      open: () => {
        setConfig({
          "store-selected": clash?.profile?.["store-selected"] ?? true,
          "store-fake-ip": clash?.profile?.["store-fake-ip"] ?? true,
        });
        setOpen(true);
      },
      close: () => setOpen(false),
    }));

    const handleSave = useLockFn(async () => {
      await saveConfig(config);
    });

    const handleConfigChange =
      (key: keyof IConfigData["profile"]) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        setConfig((prev) => ({
          ...prev,
          [key]: event.target.checked,
        }));
      };

    return (
      <BaseDialog
        open={open}
        title={t("Profile Configuration")}
        contentSx={{ width: 400 }}
        okBtn={loading ? "Saving..." : t("Save")}
        cancelBtn={t("Cancel")}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
      >
        <Box sx={{ width: "100%" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              padding: "8px 0",
              width: "100%",
            }}
          >
            <Typography variant="body1" sx={{ flexGrow: 1 }}>
              {t("Store Selected")}
            </Typography>
            <Switch
              checked={config["store-selected"]}
              onChange={handleConfigChange("store-selected")}
              color="primary"
            />
          </Box>

          <Divider sx={{ my: 1 }} />

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              padding: "8px 0",
              width: "100%",
            }}
          >
            <Typography variant="body1" sx={{ flexGrow: 1 }}>
              {t("Store Fake IP")}
            </Typography>
            <Switch
              checked={config["store-fake-ip"]}
              onChange={handleConfigChange("store-fake-ip")}
              color="primary"
            />
          </Box>
        </Box>
      </BaseDialog>
    );
  },
);
