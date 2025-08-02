import { calcuProxyProviders } from "@/services/api";
import { cn } from "@/utils";
import parseTraffic from "@/utils/parse-traffic";
import { RefreshRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  IconButton,
  LinearProgress,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import dayjs from "dayjs";
import { throttle } from "lodash-es";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";
import { updateProxyProvider } from "tauri-plugin-mihomo-api";
import { BaseDialog } from "../base";

export const ProviderButton = () => {
  const { t } = useTranslation();
  const { data = {}, mutate: mutateProxyProviders } = useSWR(
    "getProxyProviders",
    calcuProxyProviders,
  );
  const entries = Object.entries(data);
  const keys = entries.map(([key]) => key);

  const [open, setOpen] = useState(false);
  const hasProvider = keys.length > 0;
  const [updating, setUpdating] = useState(Object.keys(data).map(() => false));

  const setUpdatingAt = (status: boolean, index: number) => {
    setUpdating((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  };
  const handleUpdate = async (key: string, index: number) => {
    try {
      setUpdatingAt(true, index);
      await updateProxyProvider(key);
    } catch (e: any) {
      console.error(e);
    } finally {
      setUpdatingAt(false, index);
    }
  };

  const updateAll = throttle(async () => {
    const tasks = keys.map((key, index) => handleUpdate(key, index));
    await Promise.all(tasks);
    mutate("getProxies");
    mutateProxyProviders();
  }, 1000);

  const updateOne = throttle(async (key: string) => {
    await handleUpdate(key, keys.indexOf(key));
    mutate("getProxies");
    mutateProxyProviders();
  }, 1000);

  if (!hasProvider) return null;

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        sx={{ textTransform: "capitalize" }}
        onClick={() => setOpen(true)}>
        {t("Proxy Provider")}
      </Button>

      <BaseDialog
        open={open}
        title={
          <Box display="flex" justifyContent="space-between" gap={1}>
            <Typography variant="h6">{t("Proxy Provider")}</Typography>
            <Button
              variant="contained"
              size="small"
              onClick={async () => await updateAll()}>
              {t("Update All")}
            </Button>
          </Box>
        }
        contentStyle={{
          width: 400,
          backgroundColor: "var(--background-color)",
        }}
        hideOkBtn
        hideCancelBtn
        onClose={() => setOpen(false)}>
        <div>
          {Object.entries(data || {}).map(([key, item], index) => {
            const time = dayjs(item.updatedAt);
            const sub = item.subscriptionInfo;
            const hasSubInfo = !!sub;
            const upload = sub?.upload || 0;
            const download = sub?.download || 0;
            const total = sub?.total || 0;
            const expire = sub?.expire || 0;
            const progress = Math.round(
              ((download + upload) * 100) / (total + 0.1),
            );
            return (
              <div
                key={key}
                className="mb-2 flex items-center rounded-sm bg-white p-2 shadow-sm dark:bg-[#282A36]">
                <div className="w-full overflow-hidden pr-4">
                  <div className="flex items-center">
                    <p className="text-primary-text text-xl">{key}</p>
                    <TypeSpan>{item.proxies.length}</TypeSpan>
                  </div>
                  <StyledTypeSpan>{item.vehicleType}</StyledTypeSpan>
                  <StyledTypeSpan>
                    {t("Update At")} {time.fromNow()}
                  </StyledTypeSpan>
                  {hasSubInfo && (
                    <div className="py-1">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span title="Used / Total">
                          {parseTraffic(upload + download)} /{" "}
                          {parseTraffic(total)}
                        </span>
                        <span title="Expire Time">{parseExpire(expire)}</span>
                      </div>
                      <LinearProgress variant="determinate" value={progress} />
                    </div>
                  )}
                </div>
                <Divider orientation="vertical" flexItem />
                <IconButton
                  size="small"
                  color="inherit"
                  title={`${t("Update")}${t("Proxy Provider")}`}
                  onClick={async () => await updateOne(key)}>
                  <RefreshRounded
                    className={cn({
                      "animate-spin": updating[index],
                    })}
                  />
                </IconButton>
              </div>
            );
          })}
        </div>
      </BaseDialog>
    </>
  );
};

const TypeSpan = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.secondary.main, 0.5),
  color: alpha(theme.palette.secondary.main, 0.8),
  borderRadius: 4,
  fontSize: 12,
  marginLeft: "8px",
  marginRight: "4px",
  padding: "0 2px",
  minWidth: "15px",
  textAlign: "center",
  height: "15px",
  lineHeight: "15px",
}));

const StyledTypeSpan = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: "4px",
  fontSize: "10px",
  marginRight: "4px",
  textAlign: "center",
  padding: "1px 4px",
}));

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}
