import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  IconButton,
  useTheme,
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
import { useState, useEffect } from "react";
import { HomeProfileCard } from "@/components/home/home-profile-card";
import { EnhancedCard } from "@/components/home/enhanced-card";
import { CurrentProxyCard } from "@/components/home/current-proxy-card";
import { BasePage } from "@/components/base";
import { ClashInfoCard } from "@/components/home/clash-info-card";
import { SystemInfoCard } from "@/components/home/system-info-card";
import { useLockFn } from "ahooks";
import { entry_lightweight_mode, openWebUrl } from "@/services/cmds";
import { TestCard } from "@/components/home/test-card";
import { IpInfoCard } from "@/components/home/ip-info-card";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
  DroppableProvided,
  DraggableProvided,
} from "react-beautiful-dnd";

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

// 卡片配置接口，包含排序信息
interface CardConfig {
  id: string;
  size: number;
  enabled: boolean;
}

// 首页设置对话框组件接口
interface HomeSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  homeCards: HomeCardsSettings;
  onSave: (cards: HomeCardsSettings) => void;
}

// 确保对象符合HomeCardsSettings类型的辅助函数
const ensureHomeCardsSettings = (obj: any): HomeCardsSettings => {
  const defaultSettings: HomeCardsSettings = {
    profile: true,
    proxy: true,
    network: true,
    mode: true,
    traffic: true,
    info: false,
    clashinfo: true,
    systeminfo: true,
    test: true,
    ip: true,
  };

  if (!obj || typeof obj !== "object") return defaultSettings;

  // 合并默认值和传入对象，确保所有必要属性都存在
  return Object.keys(defaultSettings).reduce((acc, key) => {
    return {
      ...acc,
      [key]:
        typeof obj[key] === "boolean"
          ? obj[key]
          : defaultSettings[key as keyof HomeCardsSettings],
    };
  }, {} as HomeCardsSettings);
};

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

  const handleToggle = (key: keyof HomeCardsSettings) => {
    setCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    // 明确类型为HomeCardsSettings
    await patchVerge({ home_cards: cards as HomeCardsSettings });
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
                checked={cards.profile}
                onChange={() => handleToggle("profile")}
              />
            }
            label={t("Profile Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.proxy}
                onChange={() => handleToggle("proxy")}
              />
            }
            label={t("Current Proxy Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.network}
                onChange={() => handleToggle("network")}
              />
            }
            label={t("Network Settings Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.mode}
                onChange={() => handleToggle("mode")}
              />
            }
            label={t("Proxy Mode Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.traffic}
                onChange={() => handleToggle("traffic")}
              />
            }
            label={t("Traffic Stats Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.test}
                onChange={() => handleToggle("test")}
              />
            }
            label={t("Website Tests Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.ip}
                onChange={() => handleToggle("ip")}
              />
            }
            label={t("IP Information Card")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.clashinfo}
                onChange={() => handleToggle("clashinfo")}
              />
            }
            label={t("Clash Info Cards")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={cards.systeminfo}
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
  const { verge, patchVerge } = useVerge();
  const { current, mutateProfiles } = useProfiles();
  const theme = useTheme();

  // 设置弹窗的状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 卡片显示状态 - 确保类型正确
  const [homeCards, setHomeCards] = useState<HomeCardsSettings>(
    ensureHomeCardsSettings(verge?.home_cards),
  );

  // 卡片排序配置 - 默认为初始顺序
  const [cardOrder, setCardOrder] = useState<string[]>(
    // 明确断言类型
    (verge?.card_order as string[]) || [
      "profile",
      "proxy",
      "network",
      "mode",
      "traffic",
      "test",
      "ip",
      "clashinfo",
      "systeminfo",
    ],
  );

  // 当homeCards变化时，确保cardOrder中只包含启用的卡片
  useEffect(() => {
    const enabledCards = Object.entries(homeCards)
      .filter(([_, enabled]) => enabled)
      .map(([id]) => id);

    // 过滤掉已禁用的卡片
    const filteredOrder = cardOrder.filter((id) => enabledCards.includes(id));

    // 添加新启用但不在排序中的卡片
    const newCards = enabledCards.filter((id) => !filteredOrder.includes(id));

    setCardOrder([...filteredOrder, ...newCards]);
  }, [homeCards]);

  // 保存卡片排序
  const saveCardOrder = useLockFn(async (order: string[]) => {
    await patchVerge({ card_order: order } as any);
    setCardOrder(order);
  });

  // 处理拖拽结束
  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    // 拖拽到无效位置或原位置，不做处理
    if (
      !destination ||
      (destination.droppableId === source.droppableId &&
        destination.index === source.index)
    ) {
      return;
    }

    // 重新排序
    const newOrder = Array.from(cardOrder);
    newOrder.splice(source.index, 1);
    newOrder.splice(destination.index, 0, draggableId);

    // 保存新顺序
    saveCardOrder(newOrder);
  };

  // 文档链接函数
  const toGithubDoc = useLockFn(() => {
    return openWebUrl("https://clash-verge-rev.github.io/index.html");
  });

  // 卡片设置弹窗
  const openSettings = () => {
    setSettingsOpen(true);
  };

  // 保存勾选设置
  const handleSaveSettings = (newCards: HomeCardsSettings) => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => setHomeCards(newCards));
    } else {
      setTimeout(() => setHomeCards(newCards), 0);
    }
  };

  // 获取卡片配置信息
  const getCardConfig = (id: string): CardConfig => {
    const configs: Record<string, CardConfig> = {
      profile: { id: "profile", size: 6, enabled: homeCards.profile },
      proxy: { id: "proxy", size: 6, enabled: homeCards.proxy },
      network: { id: "network", size: 6, enabled: homeCards.network },
      mode: { id: "mode", size: 6, enabled: homeCards.mode },
      traffic: { id: "traffic", size: 12, enabled: homeCards.traffic },
      test: { id: "test", size: 6, enabled: homeCards.test },
      ip: { id: "ip", size: 6, enabled: homeCards.ip },
      clashinfo: { id: "clashinfo", size: 6, enabled: homeCards.clashinfo },
      systeminfo: { id: "systeminfo", size: 6, enabled: homeCards.systeminfo },
    };

    if (!configs[id]) {
      console.warn(`检测到未知卡片ID: ${id}，使用默认配置`);
      return { id, size: 6, enabled: false };
    }

    return configs[id];
  };

  // 渲染卡片内容
  const renderCardContent = (id: string) => {
    switch (id) {
      case "profile":
        return (
          <HomeProfileCard
            current={current}
            onProfileUpdated={mutateProfiles}
          />
        );
      case "proxy":
        return <CurrentProxyCard />;
      case "network":
        return <NetworkSettingsCard />;
      case "mode":
        return <ClashModeEnhancedCard />;
      case "traffic":
        return (
          <EnhancedCard
            title={t("Traffic Stats")}
            icon={<SpeedOutlined />}
            iconColor="secondary"
          >
            <EnhancedTrafficStats />
          </EnhancedCard>
        );
      case "test":
        return <TestCard />;
      case "ip":
        return <IpInfoCard />;
      case "clashinfo":
        return <ClashInfoCard />;
      case "systeminfo":
        return <SystemInfoCard />;
      default:
        console.warn(`无法渲染未知卡片: ${id}`);
        return null;
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
      {/* 拖拽上下文 */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable
          droppableId="home-cards"
          isDropDisabled={false}
          isCombineEnabled={false}
          ignoreContainerClipping={false}
        >
          {(provided: DroppableProvided) => (
            <Grid
              container
              spacing={1.5}
              columns={{ xs: 6, sm: 6, md: 12 }}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {cardOrder
                .filter((id) => {
                  const config = getCardConfig(id);
                  return homeCards[id] && config.enabled;
                })
                .map((id, index) => {
                  const config = getCardConfig(id);
                  if (!config) return null;

                  return (
                    <Draggable
                      key={id}
                      draggableId={id}
                      index={index}
                      isDragDisabled={false}
                    >
                      {(provided: DraggableProvided) => (
                        <Grid
                          size={config.size}
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          sx={{
                            cursor: "grab",
                            "&:active": {
                              cursor: "grabbing",
                            },
                          }}
                        >
                          {renderCardContent(id)}
                        </Grid>
                      )}
                    </Draggable>
                  );
                })}
              {provided.placeholder}
            </Grid>
          )}
        </Droppable>
      </DragDropContext>

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
