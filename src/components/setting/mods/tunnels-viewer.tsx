import { Delete, ExpandLess, ExpandMore } from "@mui/icons-material";
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
import { useAppData } from "@/providers/app-data-context";
import { isPortInUse } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { parseHost, parsedLocalhost, isValidPort } from "@/utils/helper";

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
    targetAddr: "",
    targetPort: "",
    network: "tcp+udp",
    group: "",
    proxy: "",
  });
  const [draftTunnels, setDraftTunnels] = useState<TunnelEntry[]>([]);

  useImperativeHandle(ref, () => ({
    open: () => {
      setValues(() => ({
        localAddr: "",
        localPort: "",
        targetAddr: "",
        targetPort: "",
        network: "tcp+udp",
        group: "",
        proxy: "",
      }));
      setDraftTunnels(() => clash?.tunnels ?? []);
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
    return draftTunnels.map((tunnel, index) => {
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
  }, [draftTunnels]);

  const { proxies } = useAppData();

  const proxyGroups = useMemo<IProxyGroupItem[]>(() => {
    return proxies?.groups ?? [];
  }, [proxies]);

  const groupNames = useMemo<string[]>(
    () => proxyGroups.map((group) => group.name),
    [proxyGroups],
  );

  const proxyOptions = useMemo<IProxyItem[]>(() => {
    const group = proxyGroups.find((item) => item.name === values.group);
    return group?.all ?? [];
  }, [proxyGroups, values.group]);

  const handleSave = async () => {
    try {
      await patchClash({ tunnels: draftTunnels });
      await mutateClash();
      showNotice.success("shared.feedback.notifications.common.saveSuccess");
      setOpen(false);
    } catch (err: any) {
      showNotice.error(err);
    }
  };

  const handleAdd = async () => {
    const { localAddr, localPort, targetAddr, targetPort, network, proxy } =
      values;

    // 基础非空校验
    if (!localAddr || !localPort || !targetAddr || !targetPort) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.incomplete",
      );
      return;
    }

    // 本地地址校验（host）
    const parsedLocal = parsedLocalhost(localAddr);
    if (!parsedLocal) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidLocalAddr",
      );
      return;
    }

    // 本地端口校验 (port)
    if (!isValidPort(localPort)) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidLocalPort",
      );
      return;
    }
    const inUse = await isPortInUse(Number(localPort));
    if (inUse) {
      showNotice.error("settings.modals.clashPort.messages.portInUse", {
        port: localPort,
      });
      return;
    }

    // 目标地址校验 (host)
    const parsedTarget = parseHost(targetAddr);
    if (!parsedTarget) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidTargetAddr",
      );
      return;
    }

    // 目标端口校验 (port)
    if (!isValidPort(targetPort)) {
      showNotice.error(
        "settings.sections.clash.form.fields.tunnels.messages.invalidTargetPort",
      );
      return;
    }

    // 构造新 entry
    const entry: TunnelEntry = {
      network: network === "tcp+udp" ? ["tcp", "udp"] : [network],
      address:
        parsedLocal.kind === "ipv6"
          ? `[${parsedLocal.host}]:${localPort}`
          : `${parsedLocal.host}:${localPort}`,
      target:
        parsedTarget.kind === "ipv6"
          ? `[${parsedTarget.host}]:${targetPort}`
          : `${parsedTarget.host}:${targetPort}`,
      ...(proxy ? { proxy } : {}),
    };

    // 写入配置 + 清空输入
    setDraftTunnels((prev) => [...prev, entry]);

    setValues((v) => ({
      ...v,
      localAddr: "",
      localPort: "",
      targetAddr: "",
      targetPort: "",
      network: "tcp+udp",
    }));
  };

  const handleDelete = (index: number) => {
    setDraftTunnels((prev) => prev.filter((_, i) => i !== index));
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
      onOk={handleSave}
    >
      <List>
        {draftTunnels.length > 0 && (
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
                      <Delete fontSize="small" />
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

              {/* 目标服务器地址 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.targetAddr",
                  )}
                />
                <TextField
                  autoComplete="new-password"
                  size="small"
                  sx={{ width: 200 }}
                  value={values.targetAddr}
                  placeholder="8.8.8.8"
                  onChange={(e) =>
                    setValues((v) => ({ ...v, targetAddr: e.target.value }))
                  }
                />
              </ListItem>

              {/* 目标服务器端口 */}
              <ListItem sx={{ padding: "6px 2px" }}>
                <ListItemText
                  primary={t(
                    "settings.sections.clash.form.fields.tunnels.targetPort",
                  )}
                />
                <TextField
                  autoComplete="new-password"
                  size="small"
                  type="number"
                  sx={{ width: 200 }}
                  value={values.targetPort}
                  placeholder="53"
                  onChange={(e) =>
                    setValues((v) => ({ ...v, targetPort: e.target.value }))
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
                sx={{
                  marginTop: "6px",
                  marginRight: "2px",
                  marginLeft: "auto",
                  display: "block",
                }}
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
