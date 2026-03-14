import {
  DeleteRounded,
  RefreshRounded,
  TuneRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  ListItemText,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Link,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from "@mui/material";
import { useCallback, useEffect, useState, useMemo } from "react";

import { BasePage } from "@/components/base";
import {
  getAppTrafficStats,
  revealFile,
  clearAppTrafficStats,
} from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

interface AppTrafficStat {
  process_name: string;
  process_path: string;
  traffic_mode: string;
  upload_bytes: number;
  download_bytes: number;
}

const FILTER_MODES = ["全部", "直连", "代理", "TUN"] as const;
type FilterMode = (typeof FILTER_MODES)[number];

const TrafficPage = () => {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [stats, setStats] = useState<AppTrafficStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [openClearDialog, setOpenClearDialog] = useState(false);

  const [sortField, setSortField] = useState<"upload" | "download" | "total">(
    "total",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Mode filter state
  const [selectedMode, setSelectedMode] = useState<FilterMode>("全部");
  const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(
    null,
  );
  const filterOpen = Boolean(filterAnchorEl);

  const handleSort = (field: "upload" | "download" | "total") => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const handleSelectMode = (mode: FilterMode) => {
    setSelectedMode(mode);
    setFilterAnchorEl(null);
  };

  const handleClearStats = async () => {
    try {
      await clearAppTrafficStats();
      showNotice.success("流量数据已清除并重新统计");
      setOpenClearDialog(false);
      fetchStats();
    } catch (err: any) {
      showNotice.error(err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAppTrafficStats(period);
      setStats(data);
    } catch (err: any) {
      showNotice.error(err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const isAllSelected = selectedMode === "全部";

  const filteredAndSortedStats = useMemo(() => {
    const filtered = isAllSelected
      ? stats
      : stats.filter((s) => s.traffic_mode === selectedMode);
    const list = [...filtered];
    list.sort((a, b) => {
      const aVal =
        sortField === "upload"
          ? a.upload_bytes
          : sortField === "download"
            ? a.download_bytes
            : a.upload_bytes + a.download_bytes;
      const bVal =
        sortField === "upload"
          ? b.upload_bytes
          : sortField === "download"
            ? b.download_bytes
            : b.upload_bytes + b.download_bytes;
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [stats, sortField, sortOrder, selectedMode, isAllSelected]);

  const periods = [
    { key: "day", label: "今日" },
    { key: "week", label: "本周" },
    { key: "month", label: "本月" },
  ] as const;

  return (
    <BasePage
      title="应用流量统计"
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <ButtonGroup variant="outlined" size="small">
            {periods.map((p) => (
              <Button
                key={p.key}
                variant={period === p.key ? "contained" : "outlined"}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </ButtonGroup>

          <IconButton size="small" onClick={fetchStats} color="inherit">
            <RefreshRounded fontSize="small" />
          </IconButton>

          <Tooltip title="清除所有流量记录">
            <IconButton
              size="small"
              onClick={() => setOpenClearDialog(true)}
              color="inherit"
              sx={{
                "&:hover": {
                  color: "error.main",
                },
                transition: "color 0.2s ease",
              }}
            >
              <DeleteRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <TableContainer
        component={Paper}
        sx={{ height: "calc(100vh - 100px)", borderRadius: 2 }}
      >
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  应用名称 / 进程
                  <Tooltip title="按模式筛选">
                    <IconButton
                      size="small"
                      onClick={(e) => setFilterAnchorEl(e.currentTarget)}
                      sx={{
                        p: 0.25,
                        color: isAllSelected
                          ? "text.secondary"
                          : "primary.main",
                      }}
                    >
                      <TuneRounded sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  {!isAllSelected && (
                    <Chip
                      label={selectedMode}
                      size="small"
                      variant="outlined"
                      color="primary"
                      sx={{ height: 20, fontSize: 11, ml: 0.5 }}
                    />
                  )}
                </Box>
                <Menu
                  anchorEl={filterAnchorEl}
                  open={filterOpen}
                  onClose={() => setFilterAnchorEl(null)}
                  slotProps={{
                    paper: {
                      sx: { minWidth: 160 },
                    },
                  }}
                >
                  {FILTER_MODES.map((mode) => (
                    <MenuItem
                      key={mode}
                      dense
                      selected={selectedMode === mode}
                      onClick={() => handleSelectMode(mode)}
                    >
                      <ListItemText>{mode}</ListItemText>
                    </MenuItem>
                  ))}
                </Menu>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === "upload"}
                  direction={sortField === "upload" ? sortOrder : "asc"}
                  onClick={() => handleSort("upload")}
                >
                  上传
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === "download"}
                  direction={sortField === "download" ? sortOrder : "asc"}
                  onClick={() => handleSort("download")}
                >
                  下载
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === "total"}
                  direction={sortField === "total" ? sortOrder : "asc"}
                  onClick={() => handleSort("total")}
                >
                  总计流量
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && stats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  加载中...
                </TableCell>
              </TableRow>
            ) : filteredAndSortedStats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              filteredAndSortedStats.map((stat) => {
                const isPathClickable =
                  stat.process_path && stat.process_path.startsWith("/");
                const displayName = stat.traffic_mode
                  ? stat.process_name + "（" + stat.traffic_mode + "）"
                  : stat.process_name;

                return (
                  <TableRow
                    key={
                      stat.process_name + stat.process_path + stat.traffic_mode
                    }
                    hover
                  >
                    <TableCell component="th" scope="row">
                      {isPathClickable ? (
                        <Tooltip
                          title={stat.process_path}
                          placement="top-start"
                        >
                          <Link
                            component="button"
                            variant="body2"
                            onClick={() => revealFile(stat.process_path)}
                            sx={{
                              color: "text.primary",
                              textDecorationColor: "text.secondary",
                            }}
                            underline="hover"
                          >
                            {displayName}
                          </Link>
                        </Tooltip>
                      ) : (
                        displayName
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatBytes(stat.upload_bytes)}
                    </TableCell>
                    <TableCell align="right">
                      {formatBytes(stat.download_bytes)}
                    </TableCell>
                    <TableCell align="right">
                      {formatBytes(stat.upload_bytes + stat.download_bytes)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openClearDialog} onClose={() => setOpenClearDialog(false)}>
        <DialogTitle>确认清除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            您确定要清除所有的应用流量统计数据吗？此操作无法恢复。清除后将立即重新开始统计。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenClearDialog(false)}>取消</Button>
          <Button color="error" onClick={handleClearStats} autoFocus>
            确定清除
          </Button>
        </DialogActions>
      </Dialog>
    </BasePage>
  );
};

export default TrafficPage;
