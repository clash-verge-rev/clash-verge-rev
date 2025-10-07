import {
  ErrorOutlineRounded,
  RefreshRounded,
  BugReportRounded,
} from "@mui/icons-material";
import { Box, Typography, Button, Alert, Collapse } from "@mui/material";
import React, { ErrorInfo, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { TrafficErrorBoundary } from "./traffic-error-boundary";

/**
 * 错误降级UI组件
 */
interface TrafficErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  canRetry: boolean;
  retryCount: number;
  maxRetries: number;
  onRetry: () => void;
  onRefresh: () => void;
  onToggleDetails: () => void;
}

export const TrafficErrorFallback: React.FC<TrafficErrorFallbackProps> = ({
  error,
  errorInfo,
  showDetails,
  canRetry,
  retryCount,
  maxRetries,
  onRetry,
  onRefresh,
  onToggleDetails,
}) => {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        p: 2,
        minHeight: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: "1px dashed",
        borderColor: "error.main",
        borderRadius: 2,
        bgcolor: "error.light",
        color: "error.contrastText",
      }}
    >
      <ErrorOutlineRounded sx={{ fontSize: 48, mb: 2, color: "error.main" }} />

      <Typography variant="h6" gutterBottom>
        {t("Traffic Statistics Error")}
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        textAlign="center"
        sx={{ mb: 2 }}
      >
        {t(
          "The traffic statistics component encountered an error and has been disabled to prevent crashes.",
        )}
      </Typography>

      <Alert severity="error" sx={{ mb: 2, maxWidth: 400 }}>
        <Typography variant="body2">
          <strong>Error:</strong> {error?.message || "Unknown error"}
        </Typography>
        {retryCount > 0 && (
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            {t("Retry attempts")}: {retryCount}/{maxRetries}
          </Typography>
        )}
      </Alert>

      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        {canRetry && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<RefreshRounded />}
            onClick={onRetry}
            size="small"
          >
            {t("Retry")}
          </Button>
        )}

        <Button variant="outlined" onClick={onRefresh} size="small">
          {t("Refresh Page")}
        </Button>

        <Button
          variant="text"
          startIcon={<BugReportRounded />}
          onClick={onToggleDetails}
          size="small"
        >
          {showDetails ? t("Hide Details") : t("Show Details")}
        </Button>
      </Box>

      <Collapse in={showDetails} sx={{ width: "100%", maxWidth: 600 }}>
        <Box
          sx={{
            p: 2,
            bgcolor: "background.paper",
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Error Details:
          </Typography>
          <Typography
            variant="caption"
            component="pre"
            sx={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "monospace",
              fontSize: "0.75rem",
              color: "text.secondary",
            }}
          >
            {error?.stack}
          </Typography>

          {errorInfo?.componentStack && (
            <>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                Component Stack:
              </Typography>
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  color: "text.secondary",
                }}
              >
                {errorInfo.componentStack}
              </Typography>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

/**
 * 轻量级流量统计错误边界
 * 用于小型流量显示组件，提供最小化的错误UI
 */
export const LightweightTrafficErrorBoundary: React.FC<{
  children: ReactNode;
}> = ({ children }) => {
  return (
    <TrafficErrorBoundary
      fallbackComponent={
        <Box
          sx={{
            p: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 60,
            bgcolor: "error.light",
            borderRadius: 1,
            color: "error.contrastText",
          }}
        >
          <ErrorOutlineRounded sx={{ mr: 1, fontSize: 20 }} />
          <Typography variant="caption">Traffic data unavailable</Typography>
        </Box>
      }
    >
      {children}
    </TrafficErrorBoundary>
  );
};
