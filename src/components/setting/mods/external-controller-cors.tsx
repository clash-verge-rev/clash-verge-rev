import { Delete as DeleteIcon } from "@mui/icons-material";
import { Box, Button, Divider, List, ListItem, TextField } from "@mui/material";
import { useLockFn, useRequest } from "ahooks";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, Switch } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/notice-service";

// 定义开发环境的URL列表
// 这些URL在开发模式下会被自动包含在允许的来源中
// 在生产环境中，这些URL会被过滤掉
// 这样可以确保在生产环境中不会意外暴露开发环境的URL
const DEV_URLS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:3000",
];

// 获取完整的源列表，包括开发URL
const getFullOrigins = (origins: string[]) => {
  // 合并现有源和开发URL，并去重
  const allOrigins = [...origins, ...DEV_URLS];
  const uniqueOrigins = [...new Set(allOrigins)];
  return uniqueOrigins;
};

// 过滤基础URL(确保后续添加)
const filterBaseOriginsForUI = (origins: string[]) => {
  return origins.filter((origin: string) => !DEV_URLS.includes(origin.trim()));
};

// 统一使用的按钮样式
const buttonStyle = {
  borderRadius: "8px",
  textTransform: "none",
  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  transition: "all 0.3s ease",
  "&:hover": {
    boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
    transform: "translateY(-1px)",
  },
  "&:active": {
    transform: "translateY(0)",
  },
};

// 添加按钮样式
const addButtonStyle = {
  ...buttonStyle,
  backgroundColor: "#4CAF50",
  color: "white",
  "&:hover": {
    backgroundColor: "#388E3C",
  },
};

// 删除按钮样式
const deleteButtonStyle = {
  ...buttonStyle,
  backgroundColor: "#FF5252",
  color: "white",
  "&:hover": {
    backgroundColor: "#D32F2F",
  },
};

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
      const origins = cors?.["allow-origins"] ?? [];
      return {
        allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
        allowOrigins: filterBaseOriginsForUI(origins),
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
        // 保存时使用完整的源列表（包括开发URL）
        const fullOrigins = getFullOrigins(corsConfig.allowOrigins);

        await patchClash({
          "external-controller-cors": {
            "allow-private-network": corsConfig.allowPrivateNetwork,
            "allow-origins": fullOrigins.filter(
              (origin: string) => origin.trim() !== "",
            ),
          },
        });
        await mutateClash();
      },
      {
        manual: true,
        onSuccess: () => {
          setOpen(false);
          showNotice.success(
            "shared.feedback.notifications.common.saveSuccess",
          );
        },
        onError: () => {
          showNotice.error("shared.feedback.notifications.common.saveFailed");
        },
      },
    );

    useImperativeHandle(ref, () => ({
      open: () => {
        const cors = clash?.["external-controller-cors"];
        const origins = cors?.["allow-origins"] ?? [];
        setCorsConfig({
          allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
          allowOrigins: filterBaseOriginsForUI(origins),
        });
        setOpen(true);
      },
      close: () => setOpen(false),
    }));

    const handleSave = useLockFn(async () => {
      await saveConfig();
    });

    const originEntries = useMemo(() => {
      const counts: Record<string, number> = {};
      return corsConfig.allowOrigins.map((origin, index) => {
        const occurrence = (counts[origin] = (counts[origin] ?? 0) + 1);
        const keyBase = origin || "origin";
        return {
          origin,
          index,
          key: `${keyBase}-${occurrence}`,
        };
      });
    }, [corsConfig.allowOrigins]);

    return (
      <BaseDialog
        open={open}
        title={t("settings.sections.externalCors.title")}
        contentSx={{ width: 500 }}
        okBtn={loading ? t("shared.statuses.saving") : t("shared.actions.save")}
        cancelBtn={t("shared.actions.cancel")}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
      >
        <List sx={{ width: "90%", padding: 2 }}>
          <ListItem sx={{ padding: "8px 0" }}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              width="100%"
            >
              <span style={{ fontWeight: "normal" }}>
                {t("settings.sections.externalCors.fields.allowPrivateNetwork")}
              </span>
              <Switch
                edge="end"
                checked={corsConfig.allowPrivateNetwork}
                onChange={(e) =>
                  handleCorsConfigChange(
                    "allowPrivateNetwork",
                    e.target.checked,
                  )
                }
              />
            </Box>
          </ListItem>

          <Divider sx={{ my: 2 }} />

          <ListItem sx={{ padding: "8px 0" }}>
            <div style={{ width: "100%" }}>
              <div style={{ marginBottom: 8, fontWeight: "bold" }}>
                {t("settings.sections.externalCors.fields.allowedOrigins")}
              </div>
              {originEntries.map(({ origin, index, key }) => (
                <div
                  key={key}
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
                    placeholder={t(
                      "settings.sections.externalCors.placeholders.origin",
                    )}
                    inputProps={{ style: { fontSize: 14 } }}
                  />
                  <Button
                    variant="contained"
                    color="error"
                    size="small"
                    onClick={() => handleDeleteOrigin(index)}
                    disabled={corsConfig.allowOrigins.length <= 0}
                    sx={deleteButtonStyle}
                  >
                    <DeleteIcon fontSize="small" />
                  </Button>
                </div>
              ))}
              <Button
                variant="contained"
                size="small"
                onClick={handleAddOrigin}
                sx={addButtonStyle}
              >
                {t("settings.sections.externalCors.actions.add")}
              </Button>

              <div
                style={{
                  marginTop: 12,
                  padding: 8,
                  backgroundColor: "#f5f5f5",
                  borderRadius: 4,
                }}
              >
                <div
                  style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}
                >
                  {t("settings.sections.externalCors.messages.alwaysIncluded", {
                    urls: DEV_URLS.join(", "),
                  })}
                </div>
              </div>
            </div>
          </ListItem>
        </List>
      </BaseDialog>
    );
  },
);
