import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Button,
  Stack,
  LinearProgress,
  alpha,
  useTheme,
  Link,
  keyframes,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  CloudUploadOutlined,
  StorageOutlined,
  UpdateOutlined,
  DnsOutlined,
  SpeedOutlined,
  EventOutlined,
  LaunchOutlined,
} from "@mui/icons-material";
import dayjs from "dayjs";
import parseTraffic from "@/utils/parse-traffic";
import { useMemo, useCallback, useState } from "react";
import { openWebUrl, updateProfile } from "@/services/cmds";
import { useLockFn } from "ahooks";
import { showNotice } from "@/services/noticeService";
import { EnhancedCard } from "./enhanced-card";
import { useAppData } from "@/providers/app-data-provider";

// 定义旋转动画
const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

// 辅助函数解析URL和过期时间
const parseUrl = (url?: string) => {
  if (!url) return "-";
  if (url.startsWith("http")) return new URL(url).host;
  return "local";
};

const parseExpire = (expire?: number) => {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
};

// 使用类型定义，而不是导入
interface ProfileExtra {
  upload: number;
  download: number;
  total: number;
  expire: number;
}

export interface ProfileItem {
  uid: string;
  type?: "local" | "remote" | "merge" | "script";
  name?: string;
  desc?: string;
  file?: string;
  url?: string;
  updated?: number;
  extra?: ProfileExtra;
  home?: string;
  option?: any;
}

export interface HomeProfileCardProps {
  current: ProfileItem | null | undefined;
  onProfileUpdated?: () => void;
}

// 添加一个通用的截断样式
const truncateStyle = {
  maxWidth: "calc(100% - 28px)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// 提取独立组件减少主组件复杂度
const ProfileDetails = ({
  current,
  onUpdateProfile,
  updating,
}: {
  current: ProfileItem;
  onUpdateProfile: () => void;
  updating: boolean;
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const usedTraffic = useMemo(() => {
    if (!current.extra) return 0;
    return current.extra.upload + current.extra.download;
  }, [current.extra]);

  const trafficPercentage = useMemo(() => {
    if (!current.extra || !current.extra.total || current.extra.total <= 0)
      return 0;
    return Math.min(Math.round((usedTraffic / current.extra.total) * 100), 100);
  }, [current.extra, usedTraffic]);

  return (
    <Box>
      <Stack spacing={2}>
        {current.url && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <DnsOutlined fontSize="small" color="action" />
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ display: "flex", alignItems: "center" }}
            >
              <span style={{ flexShrink: 0 }}>{t("From")}: </span>
              {current.home ? (
                <Link
                  component="button"
                  fontWeight="medium"
                  onClick={() => current.home && openWebUrl(current.home)}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    minWidth: 0,
                    maxWidth: "calc(100% - 40px)",
                    ml: 0.5,
                  }}
                  title={parseUrl(current.url)}
                >
                  <Typography
                    component="span"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    {parseUrl(current.url)}
                  </Typography>
                  <LaunchOutlined
                    fontSize="inherit"
                    sx={{
                      ml: 0.5,
                      fontSize: "0.8rem",
                      opacity: 0.7,
                      flexShrink: 0,
                    }}
                  />
                </Link>
              ) : (
                <Typography
                  component="span"
                  fontWeight="medium"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                    flex: 1,
                    ml: 0.5,
                  }}
                  title={parseUrl(current.url)}
                >
                  {parseUrl(current.url)}
                </Typography>
              )}
            </Typography>
          </Stack>
        )}

        {current.updated && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <UpdateOutlined
              fontSize="small"
              color="action"
              sx={{
                cursor: "pointer",
                animation: updating ? `${round} 1.5s linear infinite` : "none",
              }}
              onClick={onUpdateProfile}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ cursor: "pointer" }}
              onClick={onUpdateProfile}
            >
              {t("Update Time")}:{" "}
              <Box component="span" fontWeight="medium">
                {dayjs(current.updated * 1000).format("YYYY-MM-DD HH:mm")}
              </Box>
            </Typography>
          </Stack>
        )}

        {current.extra && (
          <>
            <Stack direction="row" alignItems="center" spacing={1}>
              <SpeedOutlined fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {t("Used / Total")}:{" "}
                <Box component="span" fontWeight="medium">
                  {parseTraffic(usedTraffic)} /{" "}
                  {parseTraffic(current.extra.total)}
                </Box>
              </Typography>
            </Stack>

            {current.extra.expire > 0 && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <EventOutlined fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">
                  {t("Expire Time")}:{" "}
                  <Box component="span" fontWeight="medium">
                    {parseExpire(current.extra.expire)}
                  </Box>
                </Typography>
              </Stack>
            )}

            <Box sx={{ mt: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: "block" }}
              >
                {trafficPercentage}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={trafficPercentage}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: alpha(theme.palette.primary.main, 0.12),
                }}
              />
            </Box>
          </>
        )}
      </Stack>
    </Box>
  );
};

// 提取空配置组件
const EmptyProfile = ({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 2.4,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
        borderRadius: 2,
      }}
      onClick={onClick}
    >
      <CloudUploadOutlined
        sx={{ fontSize: 60, color: "primary.main", mb: 2 }}
      />
      <Typography variant="h6" gutterBottom>
        {t("Import")} {t("Profiles")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("Click to import subscription")}
      </Typography>
    </Box>
  );
};

export const HomeProfileCard = ({
  current,
  onProfileUpdated,
}: HomeProfileCardProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refreshAll } = useAppData();

  // 更新当前订阅
  const [updating, setUpdating] = useState(false);

  const onUpdateProfile = useLockFn(async () => {
    if (!current?.uid) return;

    setUpdating(true);
    try {
      await updateProfile(current.uid, current.option);
      showNotice("success", t("Update subscription successfully"), 1000);
      onProfileUpdated?.();

      // 刷新首页数据
      refreshAll();
    } catch (err: any) {
      showNotice("error", err.message || err.toString(), 3000);
    } finally {
      setUpdating(false);
    }
  });

  // 导航到订阅页面
  const goToProfiles = useCallback(() => {
    navigate("/profile");
  }, [navigate]);

  // 卡片标题
  const cardTitle = useMemo(() => {
    if (!current) return t("Profiles");

    if (!current.home) return current.name;

    return (
      <Link
        component="button"
        variant="h6"
        fontWeight="medium"
        fontSize={18}
        onClick={() => current.home && openWebUrl(current.home)}
        sx={{
          color: "inherit",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          maxWidth: "100%",
          "& > span": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          },
        }}
        title={current.name}
      >
        <span>{current.name}</span>
        <LaunchOutlined
          fontSize="inherit"
          sx={{
            ml: 0.5,
            fontSize: "0.8rem",
            opacity: 0.7,
            flexShrink: 0,
          }}
        />
      </Link>
    );
  }, [current, t]);

  // 卡片操作按钮
  const cardAction = useMemo(() => {
    if (!current) return null;

    return (
      <Button
        variant="outlined"
        size="small"
        onClick={goToProfiles}
        endIcon={<StorageOutlined fontSize="small" />}
        sx={{ borderRadius: 1.5 }}
      >
        {t("Label-Profiles")}
      </Button>
    );
  }, [current, goToProfiles, t]);

  return (
    <EnhancedCard
      title={cardTitle}
      icon={<CloudUploadOutlined />}
      iconColor="info"
      action={cardAction}
    >
      {current ? (
        <ProfileDetails
          current={current}
          onUpdateProfile={onUpdateProfile}
          updating={updating}
        />
      ) : (
        <EmptyProfile onClick={goToProfiles} />
      )}
    </EnhancedCard>
  );
};
