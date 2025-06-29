import { BaseDialog } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import { Delete as DeleteIcon } from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  List,
  ListItem,
  styled,
  TextField,
} from "@mui/material";
import { useLockFn, useRequest } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

// 自定义开关按钮样式
const ToggleButton = styled("label")`
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #e0e0e0;
    transition: 0.4s;
    border-radius: 34px;

    &:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.4s;
      border-radius: 50%;
    }
  }

  input:checked + .slider {
    background-color: #2196f3;
  }

  input:focus + .slider {
    box-shadow: 0 0 1px #2196f3;
  }

  input:checked + .slider:before {
    transform: translateX(24px);
  }
`;

// 定义开发环境的URL列表
// 这些URL在开发模式下会被自动包含在允许的来源中
// 在生产环境中，这些URL会被过滤掉
// 这样可以确保在生产环境中不会意外暴露开发环境的URL
const DEV_URLS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:3000",
];

// 判断是否处于开发模式
const isDevMode = import.meta.env.MODE === "development";

// 过滤开发环境URL
const filterDevOrigins = (origins: string[]) => {
  if (isDevMode) {
    return origins;
  }
  return origins.filter((origin: string) => !DEV_URLS.includes(origin.trim()));
};

// 获取完整的源列表，包括开发URL
const getFullOrigins = (origins: string[]) => {
  if (!isDevMode) {
    return origins;
  }

  // 合并现有源和开发URL，并去重
  const allOrigins = [...origins, ...DEV_URLS];
  const uniqueOrigins = [...new Set(allOrigins)];
  return uniqueOrigins;
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

// 保存按钮样式
const saveButtonStyle = {
  ...buttonStyle,
  backgroundColor: "#165DFF",
  color: "white",
  "&:hover": {
    backgroundColor: "#0E42D2",
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
      const origins = cors?.["allow-origins"] ?? ["*"];
      return {
        allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
        allowOrigins: filterDevOrigins(origins),
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
        const origins = cors?.["allow-origins"] ?? ["*"];
        setCorsConfig({
          allowPrivateNetwork: cors?.["allow-private-network"] ?? true,
          allowOrigins: filterDevOrigins(origins),
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
          <ListItem sx={{ padding: "8px 0" }}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              width="100%"
            >
              <span style={{ fontWeight: "normal" }}>
                {t("Allow private network access")}
              </span>
              <ToggleButton>
                <input
                  type="checkbox"
                  checked={corsConfig.allowPrivateNetwork}
                  onChange={(e) =>
                    handleCorsConfigChange(
                      "allowPrivateNetwork",
                      e.target.checked,
                    )
                  }
                  id="private-network-toggle"
                />
                <span className="slider"></span>
              </ToggleButton>
            </Box>
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
                {t("Add")}
              </Button>

              {isDevMode && (
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
                    {t(
                      "Development mode: Automatically includes Tauri and localhost origins",
                    )}
                  </div>
                </div>
              )}
            </div>
          </ListItem>
        </List>
      </BaseDialog>
    );
  },
);
