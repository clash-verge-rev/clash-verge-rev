import { RefreshRounded, StorageOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateRuleProvider } from "tauri-plugin-mihomo-api";

import type {
  useRuleProvidersData,
  useRulesData,
} from "@/hooks/use-clash-data";
import { showNotice } from "@/services/notice-service";

// 辅助组件 - 类型框
const TypeBox = styled(Box)<{ component?: React.ElementType }>(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.secondary.main, 0.5),
  color: alpha(theme.palette.secondary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

type RuleProvidersHook = ReturnType<typeof useRuleProvidersData>;
type RulesHook = ReturnType<typeof useRulesData>;

interface ProviderButtonProps {
  ruleProviders: RuleProvidersHook["ruleProviders"];
  refreshRuleProviders: RuleProvidersHook["refreshRuleProviders"];
  refreshRules: RulesHook["refreshRules"];
}

export const ProviderButton = ({
  ruleProviders,
  refreshRuleProviders,
  refreshRules,
}: ProviderButtonProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  // 检查是否有提供者
  const hasProviders = Object.keys(ruleProviders || {}).length > 0;

  // 更新单个规则提供者
  const updateProvider = useLockFn(async (name: string) => {
    try {
      // 设置更新状态
      setUpdating((prev) => ({ ...prev, [name]: true }));

      await updateRuleProvider(name);

      // 刷新数据
      await refreshRules();
      await refreshRuleProviders();

      showNotice.success(
        "rules.feedback.notifications.provider.updateSuccess",
        {
          name,
        },
      );
    } catch (err) {
      showNotice.error("rules.feedback.notifications.provider.updateFailed", {
        name,
        message: String(err),
      });
    } finally {
      // 清除更新状态
      setUpdating((prev) => ({ ...prev, [name]: false }));
    }
  });

  // 更新所有规则提供者
  const updateAllProviders = useLockFn(async () => {
    try {
      // 获取所有provider的名称
      const allProviders = Object.keys(ruleProviders || {});
      if (allProviders.length === 0) {
        showNotice.info("rules.feedback.notifications.provider.none");
        return;
      }

      // 设置所有provider为更新中状态
      const newUpdating = allProviders.reduce(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      );
      setUpdating(newUpdating);

      // 改为串行逐个更新所有provider
      for (const name of allProviders) {
        try {
          await updateRuleProvider(name);
          // 每个更新完成后更新状态
          setUpdating((prev) => ({ ...prev, [name]: false }));
        } catch (err) {
          console.error(`更新 ${name} 失败`, err);
          // 继续执行下一个，不中断整体流程
        }
      }

      // 刷新数据
      await refreshRules();
      await refreshRuleProviders();

      showNotice.success("rules.feedback.notifications.provider.allUpdated");
    } catch (err) {
      showNotice.error("rules.feedback.notifications.provider.genericError", {
        message: String(err),
      });
    } finally {
      // 清除所有更新状态
      setUpdating({});
    }
  });

  const handleClose = () => {
    setOpen(false);
  };

  if (!hasProviders) return null;

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<StorageOutlined />}
        onClick={() => setOpen(true)}
      >
        {t("rules.page.provider.trigger")}
      </Button>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">
              {t("rules.page.provider.dialogTitle")}
            </Typography>
            <Button
              variant="contained"
              size="small"
              onClick={updateAllProviders}
            >
              {t("rules.page.provider.actions.updateAll")}
            </Button>
          </Box>
        </DialogTitle>

        <DialogContent>
          <List sx={{ py: 0, minHeight: 250 }}>
            {Object.entries(ruleProviders || {})
              .sort()
              .map(([key, provider]) => {
                if (!provider) return null;
                const time = dayjs(provider.updatedAt);
                const isUpdating = updating[key];

                return (
                  <ListItem
                    key={key}
                    sx={[
                      {
                        p: 0,
                        mb: "8px",
                        borderRadius: 2,
                        overflow: "hidden",
                        transition: "all 0.2s",
                      },
                      ({ palette: { mode, primary } }) => {
                        const bgcolor =
                          mode === "light" ? "#ffffff" : "#24252f";
                        const hoverColor =
                          mode === "light"
                            ? alpha(primary.main, 0.1)
                            : alpha(primary.main, 0.2);

                        return {
                          backgroundColor: bgcolor,
                          "&:hover": {
                            backgroundColor: hoverColor,
                            borderColor: alpha(primary.main, 0.3),
                          },
                        };
                      },
                    ]}
                  >
                    <ListItemText
                      sx={{ px: 2, py: 1 }}
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Typography
                            variant="subtitle1"
                            component="div"
                            noWrap
                            title={key}
                            sx={{ display: "flex", alignItems: "center" }}
                          >
                            <span style={{ marginRight: "8px" }}>{key}</span>
                            <TypeBox component="span">
                              {provider.ruleCount}
                            </TypeBox>
                          </Typography>

                          <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                          >
                            <small>{t("shared.labels.updateAt")}: </small>
                            {time.fromNow()}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Box sx={{ display: "flex" }}>
                          <TypeBox component="span">
                            {provider.vehicleType}
                          </TypeBox>
                          <TypeBox component="span">
                            {provider.behavior}
                          </TypeBox>
                        </Box>
                      }
                    />
                    <Divider orientation="vertical" flexItem />
                    <Box
                      sx={{
                        width: 40,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => updateProvider(key)}
                        disabled={isUpdating}
                        aria-label={t("rules.page.provider.actions.update")}
                        sx={{
                          animation: isUpdating
                            ? "spin 1s linear infinite"
                            : "none",
                          "@keyframes spin": {
                            "0%": { transform: "rotate(0deg)" },
                            "100%": { transform: "rotate(360deg)" },
                          },
                        }}
                        title={t("rules.page.provider.actions.update")}
                      >
                        <RefreshRounded />
                      </IconButton>
                    </Box>
                  </ListItem>
                );
              })}
          </List>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} variant="outlined">
            {t("shared.actions.close")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
