import {
  DnsOutlined,
  HelpOutlineRounded,
  HistoryEduOutlined,
  RouterOutlined,
  SettingsOutlined,
  SpeedOutlined,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Grid,
  IconButton,
  Skeleton,
  Tooltip,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BasePage } from "@/components/base";
import { ClashModeCard } from "@/components/home/clash-mode-card";
import { CurrentProxyCard } from "@/components/home/current-proxy-card";
import { EnhancedCard } from "@/components/home/enhanced-card";
import { EnhancedTrafficStats } from "@/components/home/enhanced-traffic-stats";
import { HomeProfileCard } from "@/components/home/home-profile-card";
import { ProxyTunCard } from "@/components/home/proxy-tun-card";
import { useProfiles } from "@/hooks/use-profiles";
import { useVerge } from "@/hooks/use-verge";
import { entry_lightweight_mode, openWebUrl } from "@/services/cmds";

const LazyTestCard = lazy(() =>
  import("@/components/home/test-card").then((module) => ({
    default: module.TestCard,
  })),
);
const LazyIpInfoCard = lazy(() =>
  import("@/components/home/ip-info-card").then((module) => ({
    default: module.IpInfoCard,
  })),
);
const LazyClashInfoCard = lazy(() =>
  import("@/components/home/clash-info-card").then((module) => ({
    default: module.ClashInfoCard,
  })),
);
const LazySystemInfoCard = lazy(() =>
  import("@/components/home/system-info-card").then((module) => ({
    default: module.SystemInfoCard,
  })),
);

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

const serializeCardFlags = (cards: HomeCardsSettings) =>
  Object.keys(cards)
    .sort()
    .map((key) => `${key}:${cards[key] ? 1 : 0}`)
    .join("|");

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
      <DialogTitle>{t("home.page.settings.title")}</DialogTitle>
      <DialogContent>
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.profile || false}
                onChange={() => handleToggle("profile")}
              />
            }
            label={t("home.page.settings.cards.profile")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.proxy || false}
                onChange={() => handleToggle("proxy")}
              />
            }
            label={t("home.page.settings.cards.currentProxy")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.network || false}
                onChange={() => handleToggle("network")}
              />
            }
            label={t("home.page.settings.cards.network")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.mode || false}
                onChange={() => handleToggle("mode")}
              />
            }
            label={t("home.page.settings.cards.proxyMode")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.traffic || false}
                onChange={() => handleToggle("traffic")}
              />
            }
            label={t("home.page.settings.cards.traffic")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.test || false}
                onChange={() => handleToggle("test")}
              />
            }
            label={t("home.page.settings.cards.tests")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.ip || false}
                onChange={() => handleToggle("ip")}
              />
            }
            label={t("home.page.settings.cards.ip")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.clashinfo || false}
                onChange={() => handleToggle("clashinfo")}
              />
            }
            label={t("home.page.settings.cards.clashInfo")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.systeminfo || false}
                onChange={() => handleToggle("systeminfo")}
              />
            }
            label={t("home.page.settings.cards.systemInfo")}
          />
        </FormGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("shared.actions.cancel")}</Button>
        <Button onClick={handleSave} color="primary">
          {t("shared.actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const HomePage = () => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const { current, mutateProfiles } = useProfiles();

  // 设置弹窗的状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localHomeCards, setLocalHomeCards] = useState<{
    value: HomeCardsSettings;
    baseSignature: string;
  } | null>(null);

  // 卡片显示状态
  const defaultCards = useMemo<HomeCardsSettings>(
    () => ({
      info: false,
      profile: true,
      proxy: true,
      network: true,
      mode: true,
      traffic: true,
      clashinfo: true,
      systeminfo: true,
      test: true,
      ip: true,
    }),
    [],
  );

  const vergeHomeCards = useMemo<HomeCardsSettings | null>(
    () => (verge?.home_cards as HomeCardsSettings | undefined) ?? null,
    [verge],
  );

  const remoteHomeCards = useMemo<HomeCardsSettings>(
    () => vergeHomeCards ?? defaultCards,
    [defaultCards, vergeHomeCards],
  );

  const remoteSignature = useMemo(
    () => serializeCardFlags(remoteHomeCards),
    [remoteHomeCards],
  );

  const pendingLocalCards = useMemo<HomeCardsSettings | null>(() => {
    if (!localHomeCards) return null;
    return localHomeCards.baseSignature === remoteSignature
      ? localHomeCards.value
      : null;
  }, [localHomeCards, remoteSignature]);

  const effectiveHomeCards = pendingLocalCards ?? remoteHomeCards;

  // 文档链接函数
  const toGithubDoc = useLockFn(() => {
    return openWebUrl("https://clash-verge-rev.github.io/index.html");
  });

  // 新增：打开设置弹窗
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const renderCard = useCallback(
    (cardKey: string, component: React.ReactNode, size: number = 6) => {
      if (!effectiveHomeCards[cardKey]) return null;

      return (
        <Grid size={size} key={cardKey}>
          {component}
        </Grid>
      );
    },
    [effectiveHomeCards],
  );

  const criticalCards = useMemo(
    () => [
      renderCard(
        "profile",
        <HomeProfileCard current={current} onProfileUpdated={mutateProfiles} />,
      ),
      renderCard("proxy", <CurrentProxyCard />),
      renderCard("network", <NetworkSettingsCard />),
      renderCard("mode", <ClashModeEnhancedCard />),
    ],
    [current, mutateProfiles, renderCard],
  );

  // 新增：保存设置时用requestIdleCallback/setTimeout
  const handleSaveSettings = (newCards: HomeCardsSettings) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() =>
        setLocalHomeCards({
          value: newCards,
          baseSignature: remoteSignature,
        }),
      );
    } else {
      setTimeout(
        () =>
          setLocalHomeCards({
            value: newCards,
            baseSignature: remoteSignature,
          }),
        0,
      );
    }
  };

  const nonCriticalCards = useMemo(
    () => [
      renderCard(
        "traffic",
        <EnhancedCard
          title={t("home.page.cards.trafficStats")}
          icon={<SpeedOutlined />}
          iconColor="secondary"
        >
          <EnhancedTrafficStats />
        </EnhancedCard>,
        12,
      ),
      renderCard(
        "test",
        <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
          <LazyTestCard />
        </Suspense>,
      ),
      renderCard(
        "ip",
        <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
          <LazyIpInfoCard />
        </Suspense>,
      ),
      renderCard(
        "clashinfo",
        <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
          <LazyClashInfoCard />
        </Suspense>,
      ),
      renderCard(
        "systeminfo",
        <Suspense fallback={<Skeleton variant="rectangular" height={200} />}>
          <LazySystemInfoCard />
        </Suspense>,
      ),
    ],
    [t, renderCard],
  );
  const dialogKey = useMemo(
    () => `${serializeCardFlags(effectiveHomeCards)}:${settingsOpen ? 1 : 0}`,
    [effectiveHomeCards, settingsOpen],
  );
  return (
    <BasePage
      title={t("home.page.title")}
      contentStyle={{ padding: 2 }}
      header={
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Tooltip title={t("home.page.tooltips.lightweightMode")} arrow>
            <IconButton
              onClick={async () => await entry_lightweight_mode()}
              size="small"
              color="inherit"
            >
              <HistoryEduOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("home.page.tooltips.manual")} arrow>
            <IconButton onClick={toGithubDoc} size="small" color="inherit">
              <HelpOutlineRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("home.page.tooltips.settings")} arrow>
            <IconButton onClick={openSettings} size="small" color="inherit">
              <SettingsOutlined />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        {criticalCards}

        {nonCriticalCards}
      </Grid>

      {/* 首页设置弹窗 */}
      <HomeSettingsDialog
        key={dialogKey}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        homeCards={effectiveHomeCards}
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
      title={t("home.page.cards.networkSettings")}
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
      title={t("home.page.cards.proxyMode")}
      icon={<RouterOutlined />}
      iconColor="info"
      action={null}
    >
      <ClashModeCard />
    </EnhancedCard>
  );
};

export default HomePage;
