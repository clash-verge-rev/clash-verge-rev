import { BaseDialog } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import {
  Button,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  Switch,
  TextField,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { useLockFn, useRequest } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

interface ClashHeaderConfigingRef {
  open: () => void;
  close: () => void;
}

export const HeaderConfiguration = forwardRef<ClashHeaderConfigingRef>(
  (props, ref) => {
    const { t } = useTranslation();
    const { clash, mutateClash, patchClash } = useClash();
    const [open, setOpen] = useState(false);

    // CORS配置状态管理
    const [corsConfig, setCorsConfig] = useState<{
      allowPrivateNetwork: boolean;
      allowOrigins: string[];
    }>(() => {
      const cors = clash?.["external-controller-cors"];
      return {
        allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
        allowOrigins: cors?.["allow-origins"] ?? ["*"],
      };
    });

    // 处理CORS配置变更
    const handleCorsConfigChange = (
      key: "allowPrivateNetwork" | "allowOrigins",
      value: boolean | string[],
    ) => {
      setCorsConfig((prev) => ({
        ...prev,
        [key]: value,
      }));
    };

    // 添加新的允许来源
    const handleAddOrigin = () => {
      handleCorsConfigChange("allowOrigins", [...corsConfig.allowOrigins, ""]);
    };

    // 更新允许来源列表中的某一项
    const handleUpdateOrigin = (index: number, value: string) => {
      const newOrigins = [...corsConfig.allowOrigins];
      newOrigins[index] = value;
      handleCorsConfigChange("allowOrigins", newOrigins);
    };

    // 删除允许来源列表中的某一项
    const handleDeleteOrigin = (index: number) => {
      const newOrigins = [...corsConfig.allowOrigins];
      newOrigins.splice(index, 1);
      handleCorsConfigChange("allowOrigins", newOrigins);
    };

    // 保存配置请求
    const { loading, run: saveConfig } = useRequest(
      async () => {
        await patchClash({
          "external-controller-cors": {
            "allow-private-network": corsConfig.allowPrivateNetwork,
            "allow-origins": corsConfig.allowOrigins.filter(
              (origin) => origin.trim() !== "",
            ),
          },
        });
        await mutateClash();
      },
      {
        manual: true,
        onSuccess: () => {
          setOpen(false);
          showNotice("success", t("Configuration saved successfully"));
        },
        onError: () => {
          showNotice("error", t("Failed to save configuration"));
        },
      },
    );

    useImperativeHandle(ref, () => ({
      open: () => {
        const cors = clash?.["external-controller-cors"];
        setCorsConfig({
          allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
          allowOrigins: cors?.["allow-origins"] ?? ["*"],
        });
        setOpen(true);
      },
      close: () => setOpen(false),
    }));

    const handleSave = useLockFn(async () => {
      await saveConfig();
    });

    return (
      <BaseDialog
        open={open}
        title={t("External Cors Configuration")}
        contentSx={{ width: 500 }}
        okBtn={loading ? t("Saving...") : t("Save")}
        cancelBtn={t("Cancel")}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
      >
        <List sx={{ width: "90%", padding: 2 }}>
          <ListItem sx={{ padding: "8px 0", fontWeight: "bold" }}>
            {t("External Controller CORS Settings")}
          </ListItem>

          <ListItem sx={{ padding: "8px 0" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={corsConfig.allowPrivateNetwork}
                  onChange={(e) =>
                    handleCorsConfigChange(
                      "allowPrivateNetwork",
                      e.target.checked,
                    )
                  }
                />
              }
              label={t("Allow private network access")}
            />
          </ListItem>

          <Divider sx={{ my: 2 }} />

          <ListItem sx={{ padding: "8px 0" }}>
            <div style={{ width: "100%" }}>
              <div style={{ marginBottom: 8, fontWeight: "bold" }}>
                {t("Allowed Origins")}
              </div>
              {corsConfig.allowOrigins.map((origin, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    sx={{ fontSize: 14, marginRight: 2 }}
                    value={origin}
                    onChange={(e) => handleUpdateOrigin(index, e.target.value)}
                    placeholder={t("Please enter a valid url")}
                    inputProps={{ style: { fontSize: 14 } }}
                  />
                  <Button
                    variant="contained"
                    color="error"
                    size="small"
                    onClick={() => handleDeleteOrigin(index)}
                    disabled={corsConfig.allowOrigins.length <= 1}
                  >
                    <DeleteIcon fontSize="small" />
                  </Button>
                </div>
              ))}
              <Button
                variant="contained"
                size="small"
                onClick={handleAddOrigin}
                sx={{ mt: 2 }}
              >
                {t("Add")}
              </Button>
            </div>
          </ListItem>
        </List>
      </BaseDialog>
    );
  },
);
