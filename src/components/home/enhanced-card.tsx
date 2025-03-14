import { Box, Typography, alpha, useTheme } from "@mui/material";
import { ReactNode } from "react";

// 自定义卡片组件接口
export interface EnhancedCardProps {
  title: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  iconColor?:
    | "primary"
    | "secondary"
    | "error"
    | "warning"
    | "info"
    | "success";
  minHeight?: number | string;
  noContentPadding?: boolean;
}

// 自定义卡片组件
export const EnhancedCard = ({
  title,
  icon,
  action,
  children,
  iconColor = "primary",
  minHeight,
  noContentPadding = false,
}: EnhancedCardProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        backgroundColor: isDark ? "#282a36" : "#ffffff",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 1.5,
              width: 38,
              height: 38,
              mr: 1.5,
              backgroundColor: alpha(theme.palette[iconColor].main, 0.12),
              color: theme.palette[iconColor].main,
            }}
          >
            {icon}
          </Box>
          {typeof title === "string" ? (
            <Typography variant="h6" fontWeight="medium" fontSize={18}>
              {title}
            </Typography>
          ) : (
            title
          )}
        </Box>
        {action}
      </Box>
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          p: noContentPadding ? 0 : 2,
          ...(minHeight && { minHeight }),
        }}
      >
        {children}
      </Box>
    </Box>
  );
};
