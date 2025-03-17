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
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
function convertDelayColor(delayValue: number) {
  const colorStr = delayManager.formatDelayColor(delayValue);
  if (!colorStr) return "default";

  // 从"error.main"这样的格式转为"error"
  const mainColor = colorStr.split(".")[0];

  switch (mainColor) {
    case "success": return "success";
    case "warning": return "warning";
    case "error": return "error";
    case "primary": return "primary";
    default: return "default";
  }
}

// 根据延迟值获取合适的WiFi信号图标
function getSignalIcon(delay: number) {
  if (delay < 0)
    return { icon: <SignalNone />, text: "未测试", color: "text.secondary" };
  if (delay >= 10000)
    return { icon: <SignalError />, text: "超时", color: "error.main" };
  if (delay >= 500)
    return { icon: <SignalWeak />, text: "延迟较高", color: "error.main" };
  if (delay >= 300)
    return { icon: <SignalMedium />, text: "延迟中等", color: "warning.main" };
  if (delay >= 200)
    return { icon: <SignalGood />, text: "延迟良好", color: "info.main" };
  return { icon: <SignalStrong />, text: "延迟极佳", color: "success.main" };
}

// 简单的防抖函数
function debounce(fn: Function, ms = 100) {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

export const CurrentProxyCard = () => {
  const { t } = useTranslation();
  const { currentProxy, primaryGroupName, mode, refreshProxy } = useCurrentProxy();
  const navigate = useNavigate();
  const theme = useTheme();
  const { verge } = useVerge();

  // 判断模式
  const isGlobalMode = mode === "global";
  const isDirectMode = mode === "direct";

  // 使用 useRef 存储最后一次刷新时间和是否正在刷新
  const lastRefreshRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const pendingRefreshRef = useRef<boolean>(false);

  // 定义状态类型
  type ProxyState = {
    proxyData: {
      groups: { name: string; now: string; all: string[] }[];
      records: Record<string, any>;
      globalProxy: string;
      directProxy: any;
    };
    selection: {
      group: string;
      proxy: string;
    };
    displayProxy: any;
  };

  // 合并状态，减少状态更新次数
  const [state, setState] = useState<ProxyState>({
    proxyData: {
      groups: [],
      records: {},
      globalProxy: "",
      directProxy: null,
    },
    selection: {
      group: "",
      proxy: "",
    },
    displayProxy: null,
  });

  // 初始化选择的组
  useEffect(() => {
    // 根据模式确定初始组
    if (isGlobalMode) {
      setState(prev => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: "GLOBAL"
        }
      }));
    } else if (isDirectMode) {
      setState(prev => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: "DIRECT"
        }
      }));
    } else {
      const savedGroup = localStorage.getItem(STORAGE_KEY_GROUP);
      setState(prev => ({
        ...prev,
        selection: {
          ...prev.selection,
          group: savedGroup || primaryGroupName || ""
        }
      }));
    }
  }, [isGlobalMode, isDirectMode, primaryGroupName]);

  // 带锁的代理数据获取函数，防止并发请求
  const fetchProxyData = useCallback(async (force = false) => {
    // 防止重复请求
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    // 检查刷新间隔
    const now = Date.now();
    if (!force && now - lastRefreshRef.current < 1000) {
      return;
    }

    isRefreshingRef.current = true;
    lastRefreshRef.current = now;
    
    try {
      const data = await getProxies();
      
      // 过滤和格式化组
      const filteredGroups = data.groups
        .filter(g => g.name !== "DIRECT" && g.name !== "REJECT")
        .map(g => ({
          name: g.name,
          now: g.now || "",
          all: g.all.map(p => p.name),
        }));

      // 使用函数式更新确保状态更新的原子性
      setState(prev => {
        let newProxy = "";
        let newDisplayProxy = null;
        let newGroup = prev.selection.group;

        // 根据模式确定新代理
        if (isDirectMode) {
          newGroup = "DIRECT";
          newProxy = "DIRECT";
          newDisplayProxy = data.records?.DIRECT || null;
        } else if (isGlobalMode && data.global) {
          newGroup = "GLOBAL";
          newProxy = data.global.now || "";
          newDisplayProxy = data.records?.[newProxy] || null;
        } else {
          // 普通模式 - 检查当前选择的组是否存在
          const currentGroup = filteredGroups.find(g => g.name === prev.selection.group);
          
          // 如果当前组不存在或为空，自动选择第一个组
          if (!currentGroup && filteredGroups.length > 0) {
            newGroup = filteredGroups[0].name;
            const firstGroup = filteredGroups[0];
            newProxy = firstGroup.now;
            newDisplayProxy = data.records?.[newProxy] || null;
            
            // 保存到本地存储
            if (!isGlobalMode && !isDirectMode) {
              localStorage.setItem(STORAGE_KEY_GROUP, newGroup);
              if (newProxy) {
                localStorage.setItem(STORAGE_KEY_PROXY, newProxy);
              }
            }
          } else if (currentGroup) {
            // 使用当前组的代理
            newProxy = currentGroup.now;
            newDisplayProxy = data.records?.[newProxy] || null;
          }
        }

        // 返回新状态
        return {
          proxyData: {
            groups: filteredGroups,
            records: data.records || {},
            globalProxy: data.global?.now || "",
            directProxy: data.records?.DIRECT || null,
          },
          selection: {
            group: newGroup,
            proxy: newProxy
          },
          displayProxy: newDisplayProxy
        };
      });
    } catch (error) {
      console.error("获取代理信息失败", error);
    } finally {
      isRefreshingRef.current = false;
      
      // 处理待处理的刷新请求
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        setTimeout(() => fetchProxyData(), 100);
      }
    }
  }, [isGlobalMode, isDirectMode]);

  // 响应 currentProxy 变化
  useEffect(() => {
    if (currentProxy && (!state.displayProxy || currentProxy.name !== state.displayProxy.name)) {
      fetchProxyData(true);
    }
  }, [currentProxy, fetchProxyData, state.displayProxy]);

  // 平滑的定期刷新，使用固定间隔
  useEffect(() => {
    fetchProxyData();
    
    const intervalId = setInterval(() => {
      fetchProxyData();
    }, 3000); // 使用固定的3秒间隔，平衡响应速度和性能
    
    return () => clearInterval(intervalId);
  }, [fetchProxyData]);

  // 计算要显示的代理选项 - 使用 useMemo 优化
  const proxyOptions = useMemo(() => {
    if (isDirectMode) {
      return [{ name: "DIRECT" }];
    }
    if (isGlobalMode && state.proxyData.records) {
      // 全局模式下的选项
      return Object.keys(state.proxyData.records)
        .filter(name => name !== "DIRECT" && name !== "REJECT")
        .map(name => ({ name }));
    }
    
    // 普通模式
    const group = state.proxyData.groups.find(g => g.name === state.selection.group);
    if (group) {
      return group.all.map(name => ({ name }));
    }
    return [];
  }, [isDirectMode, isGlobalMode, state.proxyData, state.selection.group]);

  // 使用防抖包装状态更新，避免快速连续更新
  const debouncedSetState = useCallback(
    debounce((updateFn: (prev: ProxyState) => ProxyState) => {
      setState(updateFn);
    }, 50),
    []
  );

  // 处理代理组变更
  const handleGroupChange = useCallback((event: SelectChangeEvent) => {
    if (isGlobalMode || isDirectMode) return;
    
    const newGroup = event.target.value;
    
    // 保存到本地存储
    localStorage.setItem(STORAGE_KEY_GROUP, newGroup);
    
    // 获取该组当前选中的代理
    setState(prev => {
      const group = prev.proxyData.groups.find(g => g.name === newGroup);
      if (group) {
        return {
          ...prev,
          selection: {
            group: newGroup,
            proxy: group.now
          },
          displayProxy: prev.proxyData.records[group.now] || null
        };
      }
      return {
        ...prev,
        selection: {
          ...prev.selection,
          group: newGroup
        }
      };
    });
  }, [isGlobalMode, isDirectMode]);

  // 处理代理节点变更
  const handleProxyChange = useCallback(async (event: SelectChangeEvent) => {
    if (isDirectMode) return;
    
    const newProxy = event.target.value;
    const currentGroup = state.selection.group;
    const previousProxy = state.selection.proxy;
    
    // 立即更新UI，优化体验
    debouncedSetState((prev: ProxyState) => ({
      ...prev,
      selection: {
        ...prev.selection,
        proxy: newProxy
      },
      displayProxy: prev.proxyData.records[newProxy] || null
    }));
    
    // 非特殊模式下保存到本地存储
    if (!isGlobalMode && !isDirectMode) {
      localStorage.setItem(STORAGE_KEY_PROXY, newProxy);
    }
    
    try {
      // 更新代理设置
      await updateProxy(currentGroup, newProxy);
      
      // 自动关闭连接设置
      if (verge?.auto_close_connection && previousProxy) {
        getConnections().then(({ connections }) => {
          connections.forEach(conn => {
            if (conn.chains.includes(previousProxy)) {
              deleteConnection(conn.id);
            }
          });
        });
      }
      
      // 刷新代理信息，使用较短的延迟
      setTimeout(() => {
        refreshProxy();
        fetchProxyData(true);
      }, 200);
    } catch (error) {
      console.error("更新代理失败", error);
    }
  }, [isDirectMode, isGlobalMode, state.proxyData.records, state.selection, verge?.auto_close_connection, refreshProxy, fetchProxyData, debouncedSetState]);

  // 导航到代理页面
  const goToProxies = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // 获取要显示的代理节点
  const proxyToDisplay = state.displayProxy || currentProxy;
  
  // 获取当前节点的延迟
  const currentDelay = proxyToDisplay
    ? delayManager.getDelayFix(proxyToDisplay, state.selection.group)
    : -1;
  
  // 获取信号图标
  const signalInfo = getSignalIcon(currentDelay);

  // 自定义渲染选择框中的值
  const renderProxyValue = useCallback((selected: string) => {
    if (!selected || !state.proxyData.records[selected]) return selected;

    const delayValue = delayManager.getDelayFix(
      state.proxyData.records[selected],
      state.selection.group
    );

    return (
      <Box sx={{ display: "flex", justifyContent: "space-between" }}>
        <Typography noWrap>{selected}</Typography>
        <Chip
          size="small"
          label={delayManager.formatDelay(delayValue)}
          color={convertDelayColor(delayValue)}
        />
      </Box>
    );
  }, [state.proxyData.records, state.selection.group]);

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

              <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                  {proxyToDisplay.type}
                </Typography>
                {isGlobalMode && (
                  <Chip size="small" label={t("Global Mode")} color="primary" sx={{ mr: 0.5 }} />
                )}
                {isDirectMode && (
                  <Chip size="small" label={t("Direct Mode")} color="success" sx={{ mr: 0.5 }} />
                )}
                {/* 节点特性 */}
                {proxyToDisplay.udp && <Chip size="small" label="UDP" variant="outlined" />}
                {proxyToDisplay.tfo && <Chip size="small" label="TFO" variant="outlined" />}
                {proxyToDisplay.xudp && <Chip size="small" label="XUDP" variant="outlined" />}
                {proxyToDisplay.mptcp && <Chip size="small" label="MPTCP" variant="outlined" />}
                {proxyToDisplay.smux && <Chip size="small" label="SMUX" variant="outlined" />}
              </Box>
            </Box>

            {/* 显示延迟 */}
            {proxyToDisplay && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
              />
            )}
          </Box>
          {/* 代理组选择器 */}
          <FormControl fullWidth variant="outlined" size="small" sx={{ mb: 1.5 }}>
            <InputLabel id="proxy-group-select-label">{t("Group")}</InputLabel>
            <Select
              labelId="proxy-group-select-label"
              value={state.selection.group}
              onChange={handleGroupChange}
              label={t("Group")}
              disabled={isGlobalMode || isDirectMode}
            >
              {state.proxyData.groups.map((group) => (
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
              value={state.selection.proxy}
              onChange={handleProxyChange}
              label={t("Proxy")}
              disabled={isDirectMode}
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
                  state.proxyData.records[proxy.name],
                  state.selection.group
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
