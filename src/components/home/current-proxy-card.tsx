import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  Chip,
  Button,
  alpha,
  useTheme,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  SelectChangeEvent,
  Tooltip,
} from "@mui/material";
import { useEffect, useState } from "react";
import {
  SignalWifi4Bar as SignalStrong,
  SignalWifi3Bar as SignalGood,
  SignalWifi2Bar as SignalMedium,
  SignalWifi1Bar as SignalWeak,
  SignalWifi0Bar as SignalNone,
  WifiOff as SignalError,
  ChevronRight,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useCurrentProxy } from "@/hooks/use-current-proxy";
import { EnhancedCard } from "@/components/home/enhanced-card";
import {
  getProxies,
  updateProxy,
  getConnections,
  deleteConnection,
} from "@/services/api";
import delayManager from "@/services/delay";
import { useVerge } from "@/hooks/use-verge";

// 本地存储的键名
const STORAGE_KEY_GROUP = "clash-verge-selected-proxy-group";
const STORAGE_KEY_PROXY = "clash-verge-selected-proxy";

// 代理节点信息接口
interface ProxyOption {
  name: string;
}

// 将delayManager返回的颜色格式转换为MUI Chip组件需要的格式
function convertDelayColor(
  delayValue: number,
):
  | "default"
  | "success"
  | "warning"
  | "error"
  | "primary"
  | "secondary"
  | "info"
  | undefined {
  const colorStr = delayManager.formatDelayColor(delayValue);
  if (!colorStr) return "default";

  // 从"error.main"这样的格式转为"error"
  const mainColor = colorStr.split(".")[0];

  switch (mainColor) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "primary":
      return "primary";
    default:
      return "default";
  }
}

// 根据延迟值获取合适的WiFi信号图标
function getSignalIcon(delay: number): {
  icon: JSX.Element;
  text: string;
  color: string;
} {
  if (delay < 0)
    return {
      icon: <SignalNone />,
      text: "未测试",
      color: "text.secondary",
    };
  if (delay >= 10000)
    return {
      icon: <SignalError />,
      text: "超时",
      color: "error.main",
    };
  if (delay >= 500)
    return {
      icon: <SignalWeak />,
      text: "延迟较高",
      color: "error.main",
    };
  if (delay >= 300)
    return {
      icon: <SignalMedium />,
      text: "延迟中等",
      color: "warning.main",
    };
  if (delay >= 200)
    return {
      icon: <SignalGood />,
      text: "延迟良好",
      color: "info.main",
    };
  return {
    icon: <SignalStrong />,
    text: "延迟极佳",
    color: "success.main",
  };
}

export const CurrentProxyCard = () => {
  const { t } = useTranslation();
  const { currentProxy, primaryGroupName, mode, refreshProxy } =
    useCurrentProxy();
  const navigate = useNavigate();
  const theme = useTheme();
  const { verge } = useVerge();

  // 判断模式
  const isGlobalMode = mode === "global";
  const isDirectMode = mode === "direct"; // 添加直连模式判断

  // 从本地存储获取初始值，如果是特殊模式或没有存储值则使用默认值
  const getSavedGroup = () => {
    // 全局模式使用 GLOBAL 组
    if (isGlobalMode) {
      return "GLOBAL";
    }
    // 直连模式使用 DIRECT
    if (isDirectMode) {
      return "DIRECT";
    }
    const savedGroup = localStorage.getItem(STORAGE_KEY_GROUP);
    return savedGroup || primaryGroupName || "GLOBAL";
  };

  // 状态管理
  const [groups, setGroups] = useState<
    { name: string; now: string; all: string[] }[]
  >([]);
  const [selectedGroup, setSelectedGroup] = useState<string>(getSavedGroup());
  const [proxyOptions, setProxyOptions] = useState<ProxyOption[]>([]);
  const [selectedProxy, setSelectedProxy] = useState<string>("");
  const [displayProxy, setDisplayProxy] = useState<any>(null);
  const [records, setRecords] = useState<Record<string, any>>({});
  const [globalProxy, setGlobalProxy] = useState<string>(""); // 存储全局代理
  const [directProxy, setDirectProxy] = useState<any>(null); // 存储直连代理信息

  // 保存选择的代理组到本地存储
  useEffect(() => {
    // 只有在普通模式下才保存到本地存储
    if (selectedGroup && !isGlobalMode && !isDirectMode) {
      localStorage.setItem(STORAGE_KEY_GROUP, selectedGroup);
    }
  }, [selectedGroup, isGlobalMode, isDirectMode]);

  // 保存选择的代理节点到本地存储
  useEffect(() => {
    // 只有在普通模式下才保存到本地存储
    if (selectedProxy && !isGlobalMode && !isDirectMode) {
      localStorage.setItem(STORAGE_KEY_PROXY, selectedProxy);
    }
  }, [selectedProxy, isGlobalMode, isDirectMode]);

  // 当模式变化时更新选择的组
  useEffect(() => {
    if (isGlobalMode) {
      setSelectedGroup("GLOBAL");
    } else if (isDirectMode) {
      setSelectedGroup("DIRECT");
    } else if (primaryGroupName) {
      const savedGroup = localStorage.getItem(STORAGE_KEY_GROUP);
      setSelectedGroup(savedGroup || primaryGroupName);
    }
  }, [isGlobalMode, isDirectMode, primaryGroupName]);

  // 获取所有代理组和代理信息
  useEffect(() => {
    const fetchProxies = async () => {
      try {
        const data = await getProxies();
        // 保存所有节点记录信息，用于显示详细节点信息
        setRecords(data.records);

        // 检查并存储全局代理信息
        if (data.global) {
          setGlobalProxy(data.global.now || "");
        }

        // 查找并存储直连代理信息
        if (data.records && data.records["DIRECT"]) {
          setDirectProxy(data.records["DIRECT"]);
        }

        const filteredGroups = data.groups
          .filter((g) => g.name !== "DIRECT" && g.name !== "REJECT")
          .map((g) => ({
            name: g.name,
            now: g.now || "",
            all: g.all.map((p) => p.name),
          }));

        setGroups(filteredGroups);

        // 直连模式处理
        if (isDirectMode) {
          // 直连模式下使用 DIRECT 节点
          setSelectedGroup("DIRECT");
          setSelectedProxy("DIRECT");

          if (data.records && data.records["DIRECT"]) {
            setDisplayProxy(data.records["DIRECT"]);
          }

          // 设置仅包含 DIRECT 节点的选项
          setProxyOptions([{ name: "DIRECT" }]);
          return;
        }

        // 全局模式处理
        if (isGlobalMode) {
          // 在全局模式下，使用 GLOBAL 组和 data.global.now 作为选中节点
          if (data.global) {
            const globalNow = data.global.now || "";
            setSelectedGroup("GLOBAL");
            setSelectedProxy(globalNow);

            if (globalNow && data.records[globalNow]) {
              setDisplayProxy(data.records[globalNow]);
            }

            // 设置全局组的代理选项
            const options = data.global.all.map((proxy) => ({
              name: proxy.name,
            }));

            setProxyOptions(options);
          }
          return;
        }

        // 以下是普通模式的处理逻辑
        let targetGroup = primaryGroupName;

        // 非特殊模式下，尝试从本地存储获取上次选择的代理组
        const savedGroup = localStorage.getItem(STORAGE_KEY_GROUP);
        targetGroup = savedGroup || primaryGroupName;

        // 如果目标组在列表中，则选择它
        if (targetGroup && filteredGroups.some((g) => g.name === targetGroup)) {
          setSelectedGroup(targetGroup);

          // 设置该组下的代理选项
          const currentGroup = filteredGroups.find(
            (g) => g.name === targetGroup,
          );
          if (currentGroup) {
            // 创建代理选项
            const options = currentGroup.all.map((proxyName) => {
              return { name: proxyName };
            });

            setProxyOptions(options);

            let targetProxy = currentGroup.now;

            const savedProxy = localStorage.getItem(STORAGE_KEY_PROXY);
            // 如果有保存的代理节点且该节点在当前组中，则选择它
            if (savedProxy && currentGroup.all.includes(savedProxy)) {
              targetProxy = savedProxy;
            }

            setSelectedProxy(targetProxy);

            if (targetProxy && data.records[targetProxy]) {
              setDisplayProxy(data.records[targetProxy]);
            }
          }
        } else if (filteredGroups.length > 0) {
          // 否则选择第一个组
          setSelectedGroup(filteredGroups[0].name);

          // 创建代理选项
          const options = filteredGroups[0].all.map((proxyName) => {
            return { name: proxyName };
          });

          setProxyOptions(options);
          setSelectedProxy(filteredGroups[0].now);

          // 更新显示的代理节点信息
          if (filteredGroups[0].now && data.records[filteredGroups[0].now]) {
            setDisplayProxy(data.records[filteredGroups[0].now]);
          }
        }
      } catch (error) {
        console.error("获取代理信息失败", error);
      }
    };

    fetchProxies();
  }, [primaryGroupName, isGlobalMode, isDirectMode]);

  // 当选择的组发生变化时更新代理选项
  useEffect(() => {
    // 如果是特殊模式，已在 fetchProxies 中处理
    if (isGlobalMode || isDirectMode) return;

    const group = groups.find((g) => g.name === selectedGroup);
    if (group && records) {
      // 创建代理选项
      const options = group.all.map((proxyName) => {
        return { name: proxyName };
      });

      setProxyOptions(options);

      let targetProxy = group.now;

      const savedProxy = localStorage.getItem(STORAGE_KEY_PROXY);
      // 如果保存的代理节点在当前组中，则选择它
      if (savedProxy && group.all.includes(savedProxy)) {
        targetProxy = savedProxy;
      }

      setSelectedProxy(targetProxy);

      if (targetProxy && records[targetProxy]) {
        setDisplayProxy(records[targetProxy]);
      }
    }
  }, [selectedGroup, groups, records, isGlobalMode, isDirectMode]);

  // 刷新代理信息
  const refreshProxyData = async () => {
    try {
      const data = await getProxies();
      // 更新所有代理记录
      setRecords(data.records);

      // 更新代理组信息
      const filteredGroups = data.groups
        .filter((g) => g.name !== "DIRECT" && g.name !== "REJECT")
        .map((g) => ({
          name: g.name,
          now: g.now || "",
          all: g.all.map((p) => p.name),
        }));

      setGroups(filteredGroups);

      // 检查并更新全局代理信息
      if (isGlobalMode && data.global) {
        const globalNow = data.global.now || "";
        setSelectedProxy(globalNow);

        if (globalNow && data.records[globalNow]) {
          setDisplayProxy(data.records[globalNow]);
        }

        // 更新全局组的代理选项
        const options = data.global.all.map((proxy) => ({
          name: proxy.name,
        }));

        setProxyOptions(options);
      }
      // 更新直连代理信息
      else if (isDirectMode && data.records["DIRECT"]) {
        setDirectProxy(data.records["DIRECT"]);
        setDisplayProxy(data.records["DIRECT"]);
      }
      // 更新普通模式下当前选中组的信息
      else {
        const currentGroup = filteredGroups.find(
          (g) => g.name === selectedGroup,
        );
        if (currentGroup) {
          // 如果当前选中的代理节点与组中的now不一致，则需要更新
          if (currentGroup.now !== selectedProxy) {
            setSelectedProxy(currentGroup.now);

            if (data.records[currentGroup.now]) {
              setDisplayProxy(data.records[currentGroup.now]);
            }
          }

          // 更新代理选项
          const options = currentGroup.all.map((proxyName) => ({
            name: proxyName,
          }));

          setProxyOptions(options);
        }
      }
    } catch (error) {
      console.error("刷新代理信息失败", error);
    }
  };

  // 每隔一段时间刷新代理信息 - 修改为在所有模式下都刷新
  useEffect(() => {
    // 初始刷新一次
    refreshProxyData();

    // 定期刷新所有模式下的代理信息
    const refreshInterval = setInterval(refreshProxyData, 2000);
    return () => clearInterval(refreshInterval);
  }, [isGlobalMode, isDirectMode, selectedGroup]); // 依赖项添加selectedGroup以便在切换组时重新设置定时器

  // 处理代理组变更
  const handleGroupChange = (event: SelectChangeEvent) => {
    // 特殊模式下不允许切换组
    if (isGlobalMode || isDirectMode) return;

    const newGroup = event.target.value;
    setSelectedGroup(newGroup);
  };

  // 处理代理节点变更
  const handleProxyChange = async (event: SelectChangeEvent) => {
    // 直连模式下不允许切换节点
    if (isDirectMode) return;

    const newProxy = event.target.value;
    const previousProxy = selectedProxy; // 保存变更前的代理节点名称

    setSelectedProxy(newProxy);

    // 更新显示的代理节点信息
    if (records[newProxy]) {
      setDisplayProxy(records[newProxy]);
    }

    try {
      // 更新代理设置
      await updateProxy(selectedGroup, newProxy);

      // 添加断开连接逻辑 - 与proxy-groups.tsx中的逻辑相同
      if (verge?.auto_close_connection && previousProxy) {
        getConnections().then(({ connections }) => {
          connections.forEach((conn) => {
            if (conn.chains.includes(previousProxy)) {
              deleteConnection(conn.id);
            }
          });
        });
      }

      setTimeout(() => {
        refreshProxy();
        if (isGlobalMode || isDirectMode) {
          refreshProxyData(); // 特殊模式下额外刷新数据
        }
      }, 300);
    } catch (error) {
      console.error("更新代理失败", error);
    }
  };

  // 导航到代理页面
  const goToProxies = () => {
    // 修正路由路径，根据_routers.tsx配置，代理页面的路径是"/"
    navigate("/");
  };

  // 获取要显示的代理节点
  const proxyToDisplay = displayProxy || currentProxy;

  // 获取当前节点的延迟
  const currentDelay = proxyToDisplay
    ? delayManager.getDelayFix(proxyToDisplay, selectedGroup)
    : -1;

  // 获取信号图标
  const signalInfo = getSignalIcon(currentDelay);

  // 自定义渲染选择框中的值
  const renderProxyValue = (selected: string) => {
    if (!selected || !records[selected]) return selected;

    const delayValue = delayManager.getDelayFix(
      records[selected],
      selectedGroup,
    );

    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Typography noWrap>{selected}</Typography>
        <Chip
          size="small"
          label={delayManager.formatDelay(delayValue)}
          color={convertDelayColor(delayValue)}
        />
      </Box>
    );
  };

  return (
    <EnhancedCard
      title={t("Current Node")}
      icon={
        <Tooltip
          title={
            proxyToDisplay
              ? `${signalInfo.text}: ${delayManager.formatDelay(currentDelay)}`
              : "无代理节点"
          }
        >
          <Box sx={{ color: signalInfo.color }}>
            {proxyToDisplay ? signalInfo.icon : <SignalNone color="disabled" />}
          </Box>
        </Tooltip>
      }
      iconColor={proxyToDisplay ? "primary" : undefined}
      action={
        <Button
          variant="outlined"
          size="small"
          onClick={goToProxies}
          sx={{ borderRadius: 1.5 }}
          endIcon={<ChevronRight fontSize="small" />}
        >
          {t("Label-Proxies")}
        </Button>
      }
    >
      {proxyToDisplay ? (
        <Box>
          {/* 代理节点信息显示 */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1,
              mb: 2,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Box>
              <Typography variant="body1" fontWeight="medium">
                {proxyToDisplay.name}
              </Typography>

              <Box
                sx={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mr: 1 }}
                >
                  {proxyToDisplay.type}
                </Typography>
                {isGlobalMode && (
                  <Chip
                    size="small"
                    label={t("Global Mode")}
                    color="primary"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {isDirectMode && (
                  <Chip
                    size="small"
                    label={t("Direct Mode")}
                    color="success"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {/* 节点特性 */}
                {proxyToDisplay.udp && (
                  <Chip size="small" label="UDP" variant="outlined" />
                )}
                {proxyToDisplay.tfo && (
                  <Chip size="small" label="TFO" variant="outlined" />
                )}
                {proxyToDisplay.xudp && (
                  <Chip size="small" label="XUDP" variant="outlined" />
                )}
                {proxyToDisplay.mptcp && (
                  <Chip size="small" label="MPTCP" variant="outlined" />
                )}
                {proxyToDisplay.smux && (
                  <Chip size="small" label="SMUX" variant="outlined" />
                )}
              </Box>
            </Box>

            {/* 显示延迟 */}
            {proxyToDisplay && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(
                  delayManager.getDelayFix(proxyToDisplay, selectedGroup),
                )}
                color={convertDelayColor(
                  delayManager.getDelayFix(proxyToDisplay, selectedGroup),
                )}
              />
            )}
          </Box>
          {/* 代理组选择器 */}
          <FormControl
            fullWidth
            variant="outlined"
            size="small"
            sx={{ mb: 1.5 }}
          >
            <InputLabel id="proxy-group-select-label">{t("Group")}</InputLabel>
            <Select
              labelId="proxy-group-select-label"
              value={selectedGroup}
              onChange={handleGroupChange}
              label={t("Group")}
              disabled={isGlobalMode || isDirectMode} // 特殊模式下禁用选择器
            >
              {groups.map((group) => (
                <MenuItem key={group.name} value={group.name}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 代理节点选择器 */}
          <FormControl fullWidth variant="outlined" size="small" sx={{ mb: 0 }}>
            <InputLabel id="proxy-select-label">{t("Proxy")}</InputLabel>
            <Select
              labelId="proxy-select-label"
              value={selectedProxy}
              onChange={handleProxyChange}
              label={t("Proxy")}
              disabled={isDirectMode} // 直连模式下禁用选择器
              renderValue={renderProxyValue}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 500,
                  },
                },
              }}
            >
              {proxyOptions.map((proxy) => {
                const delayValue = delayManager.getDelayFix(
                  records[proxy.name],
                  selectedGroup,
                );
                return (
                  <MenuItem
                    key={proxy.name}
                    value={proxy.name}
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      pr: 1,
                    }}
                  >
                    <Typography noWrap sx={{ flex: 1, mr: 1 }}>
                      {proxy.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={delayManager.formatDelay(delayValue)}
                      color={convertDelayColor(delayValue)}
                      sx={{
                        minWidth: "60px",
                        height: "22px",
                        flexShrink: 0,
                      }}
                    />
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        </Box>
      ) : (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="body1" color="text.secondary">
            {t("No active proxy node")}
          </Typography>
        </Box>
      )}
    </EnhancedCard>
  );
};
