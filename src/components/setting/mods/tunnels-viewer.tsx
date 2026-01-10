import { Delete as DeleteIcon } from "@mui/icons-material";
import { ExpandLess, ExpandMore } from "@mui/icons-material";
import {
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  IconButton,
  TextField,
  Select,
  MenuItem,
} from "@mui/material";
import { forwardRef, useImperativeHandle, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { useProxiesData } from "@/hooks/use-clash-data";
import { showNotice } from "@/services/notice-service";
import {
  parseUrlLike,
  parseRequiredPort,
  isIPv4,
  isIPv6,
} from "@/utils/uri-parser/helpers";

interface TunnelsViewerRef {
  open: () => void;
  close: () => void;
}

interface TunnelEntry {
  network: string[];
  address: string;
  target: string;
  proxy?: string;
}

export const TunnelsViewer = forwardRef<TunnelsViewerRef>((_, ref) => {
  const { t } = useTranslation();
  const { clash, mutateClash, patchClash } = useClash();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState({
    localAddr: "",
    localPort: "",
    target: "",
    network: "tcp+udp",
    group: "",
    proxy: "",
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setValues(() => ({
        localAddr: "",
        localPort: "",
        target: "",
        network: "tcp+udp",
        group: "",
        proxy: "",
      }));
      setOpen(true);
      // 如果没有隧道，则自动展开
      setExpanded((clash?.tunnels ?? []).length === 0);
    },
    close: () => {
      setOpen(false);
    },
  }));

  const tunnelEntries = useMemo(() => {
    const counts: Record<string, number> = {};
    return (clash?.tunnels ?? []).map((tunnel, index) => {
      const base = `${tunnel.address}_${tunnel.target}_${tunnel.network.join("+")}`;
      const occurrence = (counts[base] = (counts[base] ?? 0) + 1);
      return {
        index,
        key: `${base}_${occurrence}`,
        address: tunnel.address,
        target: tunnel.target,
        network: tunnel.network,
        proxy: tunnel.proxy,
      };
    });
  }, [clash?.tunnels]);

  const { proxies } = useProxiesData();

  const proxyGroups = useMemo(() => {
    return proxies?.groups ?? [];
  }, [proxies]);

  const groupNames = useMemo(
    () => proxyGroups.map((g) => g.name),
    [proxyGroups],
  );

  const proxyOptions = useMemo(() => {
    const group = proxyGroups.find((g) => g.name === values.group);
    return group?.all ?? [];
  }, [proxyGroups, values.group]);

  // 简单的 host 校验：支持 IPv4 / IPv6 / 域名 / localhost
  const isValidHost = (input: string): boolean => {
    // 禁止空白（如空格、\t、\n） 和 连续点（..）
    if (/\s/.test(input) || input.includes("..")) return false;
    // IPv4 或 IPv6
    if (isIPv4(input) || isIPv6(input)) return true;
    // 允许局域网 / 普通主机名
    return /^[a-zA-Z0-9.-]+$/.test(input);
  };

  const saveTunnels = async (tunnels: TunnelEntry[]) => {
    try {
      await patchClash({ tunnels });
      await mutateClash();
      showNotice.success("shared.feedback.notifications.common.saveSuccess");
    } catch {
      showNotice.error("shared.feedback.notifications.common.saveFailed");
    }
  };

  const handleAdd = () => {
    const { localAddr, localPort, target, network, proxy } = values;

    // 1. 基础非空校验
    if (!localAddr || !localPort || !target) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.incomplete",
      );
      return;
    }

    // 2. 本地地址校验（host）
    if (!isValidHost(localAddr)) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidLocalAddr",
      );
      return;
    }

    // 3. 本地端口校验（只调用 parseRequiredPort，不接返回值）
    try {
      parseRequiredPort(localPort, "invalid-local-port");
    } catch {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidLocalPort",
      );
      return;
    }

    // 4. 目标地址校验：先用 parseUrlLike 拆 host/port
    const parseAndValidateTarget = (raw: string): string | null => {
      try {
        const { host = "", port } = parseUrlLike(raw, {
          errorMessage: "invalid-target",
        });

        const trimmedHost = host.trim();
        if (!trimmedHost || !isValidHost(trimmedHost)) {
          return null;
        }

        parseRequiredPort(port, "invalid-target-port");
        return `${trimmedHost}:${port}`;
      } catch {
        return null;
      }
    };

    const normalizedTarget = parseAndValidateTarget(target);
    if (!normalizedTarget) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidTarget",
      );
      return;
    }

    // 5. 构造新 entry
    const entry: TunnelEntry = {
      network: network === "tcp+udp" ? ["tcp", "udp"] : [network],
      address: `${localAddr}:${localPort}`,
      target: normalizedTarget,
      ...(proxy ? { proxy } : {}),
    };

    // 6. 写入配置 + 清空输入
    saveTunnels([...(clash?.tunnels ?? []), entry]);

    setValues((v) => ({
      ...v,
      localAddr: "",
      localPort: "",
      target: "",
      network: "tcp+udp",
    }));
  };

  const handleDelete = (index: number) => {
    saveTunnels((clash?.tunnels ?? []).filter((_, i) => i !== index));
  };

  return (
    <BaseDialog
      open={open}
      title={t("settings.sections.clash.form.fields.tunnels.title")}
      contentSx={{ width: 450 }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => {
        setOpen(false);
      }}
      onCancel={() => {
        setOpen(false);
      }}
      onOk={() => {
        setOpen(false);
      }}
    >
      <List>
        {(clash?.tunnels ?? []).length > 0 && (
          <>
            <ListItem sx={{ padding: "4px 0", opacity: 0.6 }}>
              <ListItemText
                primary={t(
                  "settings.sections.clash.form.fields.tunnels.existing",
                )}
              />
            </ListItem>
            <List component="nav">
              {tunnelEntries.map((item) => (
                <ListItem
                  key={`${item.key}`}
                  sx={{ padding: "4px 0" }}
                  secondaryAction={
                    <IconButton
                      edge="end"
                      size="small"
                      color="error"
                      onClick={() => handleDelete(item.index)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={`${item.address} → ${item.target}`}
                    secondary={`${item.network.join(", ")} · ${
                      item.proxy ??
                      t("settings.sections.clash.form.fields.tunnels.default")
                    }`}
                  />
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 2 }} />
          </>
        )}
        <ListItemButton
          sx={{ padding: "4px 0", opacity: 0.8 }}
          onClick={() => setExpanded((v) => !v)}
        >
          <ListItemText
            primary={t(
              "settings.sections.clash.form.fields.tunnels.actions.addNew",
            )}
          />
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
        {expanded && (
          <ListItem sx={{ padding: "8px 0" }}>
            <div style={{ width: "100%" }}>
              {/* 输入框区域 */}
              {/* 协议 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.protocols",
                  )}
                />
                <Select
                  size="small"
                  sx={{ width: 200, "> div": { py: "7.5px" } }}
                  value={values.network}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      network: e.target.value as string,
                    }))
                  }
                >
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="tcp+udp">TCP + UDP</MenuItem>
                </Select>
              </ListItem>

              {/* 本地监听地址 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.localAddr",
                  )}
                />
                <TextField
                  autoComplete="new-password"
                  size="small"
                  sx={{ width: 200 }}
                  value={values.localAddr}
                  placeholder="127.0.0.1"
                  onChange={(e) =>
                    setValues((v) => ({ ...v, localAddr: e.target.value }))
                  }
                />
              </ListItem>

              {/* 本地监听端口 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.localPort",
                  )}
                />
                <TextField
                  autoComplete="new-password"
                  size="small"
                  type="number"
                  sx={{ width: 200 }}
                  value={values.localPort}
                  placeholder="6553"
                  onChange={(e) =>
                    setValues((v) => ({ ...v, localPort: e.target.value }))
                  }
                />
              </ListItem>

              {/* 目标服务器 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.target",
                  )}
                />
                <TextField
                  autoComplete="new-password"
                  size="small"
                  sx={{ width: 200 }}
                  value={values.target}
                  placeholder="8.8.8.8:53"
                  onChange={(e) =>
                    setValues((v) => ({ ...v, target: e.target.value }))
                  }
                />
              </ListItem>

              {/* 代理组 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={
                    <>
                      {t(
                        "settings.sections.clash.form.fields.tunnels.proxyGroup",
                      )}
                      <span style={{ fontSize: "0.9rem", color: "gray" }}>
                        {" "}
                        (
                        {t(
                          "settings.sections.clash.form.fields.tunnels.optional",
                        )}
                        )
                      </span>
                    </>
                  }
                />
                <Select
                  size="small"
                  sx={{ width: 200, "> div": { py: "7.5px" } }}
                  value={values.group}
                  displayEmpty
                  onChange={(e) => {
                    const nextGroup = e.target.value as string;
                    const group = proxyGroups.find((g) => g.name === nextGroup);
                    const firstProxy = group?.all?.[0].name ?? "";

                    setValues((v) => ({
                      ...v,
                      group: nextGroup,
                      proxy: firstProxy, // 组切换时自动选第一条节点
                    }));
                  }}
                >
                  <MenuItem value="">
                    {t("settings.sections.clash.form.fields.tunnels.default")}
                  </MenuItem>
                  {groupNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </ListItem>

              {/* 代理节点 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={
                    <>
                      {t(
                        "settings.sections.clash.form.fields.tunnels.proxyNode",
                      )}
                      <span style={{ fontSize: "0.9rem", color: "gray" }}>
                        {" "}
                        (
                        {t(
                          "settings.sections.clash.form.fields.tunnels.optional",
                        )}
                        )
                      </span>
                    </>
                  }
                />
                <Select
                  size="small"
                  sx={{ width: 200, "> div": { py: "7.5px" } }}
                  value={values.proxy}
                  displayEmpty
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      proxy: e.target.value as string,
                    }))
                  }
                  disabled={!values.group} // 没选组就禁用
                >
                  <MenuItem value="">
                    {t("settings.sections.clash.form.fields.tunnels.default")}
                  </MenuItem>
                  {proxyOptions.map((node) => (
                    <MenuItem key={node.name} value={node.name}>
                      {node.name}
                    </MenuItem>
                  ))}
                </Select>
              </ListItem>

              {/* 添加按钮 */}
              <Button
                variant="contained"
                size="small"
                color="success"
                onClick={handleAdd}
              >
                {t("settings.sections.clash.form.fields.tunnels.actions.add")}
              </Button>
            </div>
          </ListItem>
        )}
      </List>
    </BaseDialog>
  );
});
