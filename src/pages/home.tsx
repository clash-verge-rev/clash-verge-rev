import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  IconButton,
  useTheme,
  keyframes,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Tooltip,
  Grid,
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { useProfiles } from "@/hooks/use-profiles";
import {
  RouterOutlined,
  SettingsOutlined,
  DnsOutlined,
  SpeedOutlined,
  HelpOutlineRounded,
  HistoryEduOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { ProxyTunCard } from "@/components/home/proxy-tun-card";
import { ClashModeCard } from "@/components/home/clash-mode-card";
import { EnhancedTrafficStats } from "@/components/home/enhanced-traffic-stats";
import { useState } from "react";
import { HomeProfileCard } from "@/components/home/home-profile-card";
import { EnhancedCard } from "@/components/home/enhanced-card";
import { CurrentProxyCard } from "@/components/home/current-proxy-card";
import { BasePage } from "@/components/base";
import { ClashInfoCard } from "@/components/home/clash-info-card";
import { SystemInfoCard } from "@/components/home/system-info-card";
import { useLockFn } from "ahooks";
import {
  entry_lightweight_mode,
  openWebUrl,
  patchVergeConfig,
} from "@/services/cmds";
import { TestCard } from "@/components/home/test-card";
import { IpInfoCard } from "@/components/home/ip-info-card";

// 定义旋转动画
const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

// 辅助函数解析URL和过期时间
function parseUrl(url?: string) {
  if (!url) return "-";
  if (url.startsWith("http")) return new URL(url).host;
  return "local";
}

// 定义首页卡片设置接口
interface HomeCardsSettings {
  profile: boolean;
  proxy: boolean;
  network: boolean;
  mode: boolean;
  traffic: boolean;
  info: boolean;
  clashinfo: boolean;
  systeminfo: boolean;
  test: boolean;
  ip: boolean;
  [key: string]: boolean;
}

// 首页设置对话框组件接口
interface HomeSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  homeCards: HomeCardsSettings;
  onSave: (cards: HomeCardsSettings) => void;
}

// 首页设置对话框组件
const HomeSettingsDialog = ({
  open,
  onClose,
  homeCards,
  onSave,
}: HomeSettingsDialogProps) => {
  const { t } = useTranslation();
  const [cards, setCards] = useState<HomeCardsSettings>(homeCards);
  const { patchVerge } = useVerge();

  const handleToggle = (key: string) => {
    setCards((prev: HomeCardsSettings) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    await patchVerge({ home_cards: cards });
    onSave(cards);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("Home Settings")}</DialogTitle>
      <DialogContent>
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.profile || false}
                onChange={() => handleToggle("profile")}
              />
            }
            label={t("Profile Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.proxy || false}
                onChange={() => handleToggle("proxy")}
              />
            }
            label={t("Current Proxy Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.network || false}
                onChange={() => handleToggle("network")}
              />
            }
            label={t("Network Settings Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.mode || false}
                onChange={() => handleToggle("mode")}
              />
            }
            label={t("Proxy Mode Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.traffic || false}
                onChange={() => handleToggle("traffic")}
              />
            }
            label={t("Traffic Stats Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.test || false}
                onChange={() => handleToggle("test")}
              />
            }
            label={t("Website Tests Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.ip || false}
                onChange={() => handleToggle("ip")}
              />
            }
            label={t("IP Information Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.clashinfo || false}
                onChange={() => handleToggle("clashinfo")}
              />
            }
            label={t("Clash Info Cards")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.systeminfo || false}
                onChange={() => handleToggle("systeminfo")}
              />
            }
            label={t("System Info Cards")}
          />
        </FormGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button onClick={handleSave} color="primary">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const HomePage = () => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const { current, mutateProfiles } = useProfiles();
  const navigate = useNavigate();
  const theme = useTheme();

  // 设置弹窗的状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 卡片显示状态
  const [homeCards, setHomeCards] = useState<HomeCardsSettings>(
    (verge?.home_cards as HomeCardsSettings) || {
      profile: true,
      proxy: true,
      network: true,
      mode: true,
      traffic: true,
      clashinfo: true,
      systeminfo: true,
      test: true,
      ip: true,
    },
  );

  // 导航到订阅页面
  const goToProfiles = () => {
    navigate("/profile");
  };

  // 导航到代理页面
  const goToProxies = () => {
    navigate("/");
  };

  // 导航到设置页面
  const goToSettings = () => {
    navigate("/settings");
  };

  // 文档链接函数
  const toGithubDoc = useLockFn(() => {
    return openWebUrl("https://clash-verge-rev.github.io/index.html");
  });

  // 新增：打开设置弹窗
  const openSettings = () => {
    setSettingsOpen(true);
  };

  // 新增：保存设置时用requestIdleCallback/setTimeout
  const handleSaveSettings = (newCards: HomeCardsSettings) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => setHomeCards(newCards));
    } else {
      setTimeout(() => setHomeCards(newCards), 0);
    }
  };

  return (
    <BasePage
      title={t("Label-Home")}
      contentStyle={{ padding: 2 }}
      header={
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Tooltip title={t("LightWeight Mode")} arrow>
            <IconButton
              onClick={async () => await entry_lightweight_mode()}
              size="small"
              color="inherit"
            >
              <HistoryEduOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("Manual")} arrow>
            <IconButton onClick={toGithubDoc} size="small" color="inherit">
              <HelpOutlineRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("Home Settings")} arrow>
            <IconButton onClick={openSettings} size="small" color="inherit">
              <SettingsOutlined />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        {/* 订阅和当前节点部分 */}
        {homeCards.profile && (
          <Grid size={6}>
            <HomeProfileCard
              current={current}
              onProfileUpdated={mutateProfiles}
            />
          </Grid>
        )}

        {homeCards.proxy && (
          <Grid size={6}>
            <CurrentProxyCard />
          </Grid>
        )}

        {/* 代理和网络设置区域 */}
        {homeCards.network && (
          <Grid size={6}>
            <NetworkSettingsCard />
          </Grid>
        )}

        {homeCards.mode && (
          <Grid size={6}>
            <ClashModeEnhancedCard />
          </Grid>
        )}

        {/* 增强的流量统计区域 */}
        {homeCards.traffic && (
          <Grid size={12}>
            <EnhancedCard
              title={t("Traffic Stats")}
              icon={<SpeedOutlined />}
              iconColor="secondary"
            >
              <EnhancedTrafficStats />
            </EnhancedCard>
          </Grid>
        )}
        {/* 测试网站部分 */}
        {homeCards.test && (
          <Grid size={6}>
            <TestCard />
          </Grid>
        )}
        {/* IP信息卡片 */}
        {homeCards.ip && (
          <Grid size={6}>
            <IpInfoCard />
          </Grid>
        )}
        {/* Clash信息 */}
        {homeCards.clashinfo && (
          <Grid size={6}>
            <ClashInfoCard />
          </Grid>
        )}
        {/* 系统信息 */}
        {homeCards.systeminfo && (
          <Grid size={6}>
            <SystemInfoCard />
          </Grid>
        )}
      </Grid>

      {/* 首页设置弹窗 */}
      <HomeSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        homeCards={homeCards}
        onSave={handleSaveSettings}
      />
    </BasePage>
  );
};

// 增强版网络设置卡片组件
const NetworkSettingsCard = () => {
  const { t } = useTranslation();
  return (
    <EnhancedCard
      title={t("Network Settings")}
      icon={<DnsOutlined />}
      iconColor="primary"
      action={null}
    >
      <ProxyTunCard />
    </EnhancedCard>
  );
};

// 增强版 Clash 模式卡片组件
const ClashModeEnhancedCard = () => {
  const { t } = useTranslation();
  return (
    <EnhancedCard
      title={t("Proxy Mode")}
      icon={<RouterOutlined />}
      iconColor="info"
      action={null}
    >
      <ClashModeCard />
    </EnhancedCard>
  );
};

export default HomePage;
