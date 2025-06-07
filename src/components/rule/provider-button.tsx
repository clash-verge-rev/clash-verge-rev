import { useState } from "react";
import {
  Button,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  Divider,
  alpha,
  styled,
  useTheme,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { ruleProviderUpdate } from "@/services/api";
import { StorageOutlined, RefreshRounded } from "@mui/icons-material";
import { useAppData } from "@/providers/app-data-provider";
import dayjs from "dayjs";
import { showNotice } from "@/services/noticeService";

// 定义规则提供者类型
interface RuleProviderItem {
  behavior: string;
  ruleCount: number;
  updatedAt: number;
  vehicleType: string;
}

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

export const ProviderButton = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { ruleProviders, refreshRules, refreshRuleProviders } = useAppData();
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  // 检查是否有提供者
  const hasProviders = Object.keys(ruleProviders || {}).length > 0;

  // 更新单个规则提供者
  const updateProvider = useLockFn(async (name: string) => {
    try {
      // 设置更新状态
      setUpdating((prev) => ({ ...prev, [name]: true }));

      await ruleProviderUpdate(name);

      // 刷新数据
      await refreshRules();
      await refreshRuleProviders();

      showNotice("success", `${name} 更新成功`);
    } catch (err: any) {
      showNotice(
        "error",
        `${name} 更新失败: ${err?.message || err.toString()}`,
      );
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
        showNotice("info", "没有可更新的规则提供者");
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
          await ruleProviderUpdate(name);
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

      showNotice("success", "全部规则提供者更新成功");
    } catch (err: any) {
      showNotice("error", `更新失败: ${err?.message || err.toString()}`);
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
        {t("Rule Provider")}
      </Button>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6">{t("Rule Providers")}</Typography>
            <Button
              variant="contained"
              size="small"
              onClick={updateAllProviders}
            >
              {t("Update All")}
            </Button>
          </Box>
        </DialogTitle>

        <DialogContent>
          <List sx={{ py: 0, minHeight: 250 }}>
            {Object.entries(ruleProviders || {}).map(([key, item]) => {
              const provider = item as RuleProviderItem;
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
                      const bgcolor = mode === "light" ? "#ffffff" : "#24252f";
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
                          <small>{t("Update At")}: </small>
                          {time.fromNow()}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: "flex" }}>
                        <TypeBox component="span">
                          {provider.vehicleType}
                        </TypeBox>
                        <TypeBox component="span">{provider.behavior}</TypeBox>
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
                      sx={{
                        animation: isUpdating
                          ? "spin 1s linear infinite"
                          : "none",
                        "@keyframes spin": {
                          "0%": { transform: "rotate(0deg)" },
                          "100%": { transform: "rotate(360deg)" },
                        },
                      }}
                      title={t("Update Provider") as string}
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
            {t("Close")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
