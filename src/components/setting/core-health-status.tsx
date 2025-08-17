import { useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CheckCircle,
  Error,
  Warning,
  Refresh,
  RestartAlt,
  HealthAndSafetyRounded,
} from "@mui/icons-material";
import {
  resetCoreRecoveryState,
  attemptCoreAutoRecovery,
} from "@/services/cmds";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";

interface CoreHealthStatusProps {
  onError?: (err: Error) => void;
}

export const CoreHealthStatus = ({ onError }: CoreHealthStatusProps) => {
  const { t } = useTranslation();
  const { version } = useClash();
  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // 基于version判断内核健康状态
  const isHealthy = version && version !== "-";
  const healthStatus = isHealthy ? "healthy" : "unhealthy";

  const getStatusColor = () => {
    switch (healthStatus) {
      case "healthy":
        return "success";
      case "unhealthy":
        return "error";
      default:
        return "warning";
    }
  };

  const getStatusIcon = () => {
    switch (healthStatus) {
      case "healthy":
        return <CheckCircle sx={{ color: "success.main", mr: 1 }} />;
      case "unhealthy":
        return <Error sx={{ color: "error.main", mr: 1 }} />;
      default:
        return <Warning sx={{ color: "warning.main", mr: 1 }} />;
    }
  };

  const getStatusText = () => {
    switch (healthStatus) {
      case "healthy":
        return t("Core Running Normally");
      case "unhealthy":
        return t("Core Not Responding");
      default:
        return t("Core Status Unknown");
    }
  };

  const handleResetRecoveryState = useLockFn(async () => {
    try {
      setLoading(true);
      await resetCoreRecoveryState();
      showNotice("success", t("Core recovery state has been reset"));
    } catch (error) {
      showNotice(
        "error",
        error?.toString() || t("Failed to reset recovery state"),
      );
      onError?.(error as Error);
    } finally {
      setLoading(false);
    }
  });

  const handleAttemptRecovery = useLockFn(async () => {
    try {
      setRecoveryLoading(true);
      await attemptCoreAutoRecovery();
      showNotice("success", t("Automatic recovery attempt completed"));
    } catch (error) {
      showNotice("error", error?.toString() || t("Automatic recovery failed"));
      onError?.(error as Error);
    } finally {
      setRecoveryLoading(false);
    }
  });

  return (
    <SettingList title={t("Core Health Status")}>
      <SettingItem
        label={t("Core Status")}
        extra={
          <Box display="flex" alignItems="center" gap={1}>
            <TooltipIcon
              title={t(
                "The system automatically monitors core health every 30 seconds and will attempt recovery if issues are detected.",
              )}
              icon={HealthAndSafetyRounded}
            />
            {getStatusIcon()}
            <Chip
              label={getStatusText()}
              color={getStatusColor() as any}
              variant="outlined"
              size="small"
            />
            <Tooltip title={t("Reset Recovery State")}>
              <Button
                variant="outlined"
                onClick={handleResetRecoveryState}
                disabled={loading || recoveryLoading}
                size="small"
                sx={{ minWidth: "32px", p: "4px" }}
              >
                {loading ? <CircularProgress size={16} /> : <Refresh />}
              </Button>
            </Tooltip>
            <Tooltip title={t("Attempt Recovery")}>
              <Button
                variant="contained"
                onClick={handleAttemptRecovery}
                disabled={loading || recoveryLoading}
                size="small"
                color={isHealthy ? "primary" : "error"}
                sx={{ minWidth: "32px", p: "4px" }}
              >
                {recoveryLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  <RestartAlt />
                )}
              </Button>
            </Tooltip>
            {version && (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {version}
              </Typography>
            )}
          </Box>
        }
      >
        {!isHealthy && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t(
              "Core is not responding properly. You can try automatic recovery or restart the application.",
            )}
          </Alert>
        )}
      </SettingItem>
    </SettingList>
  );
};
