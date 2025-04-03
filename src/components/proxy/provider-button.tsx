import { calcuProxyProviders } from "@/services/api";
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
  keyframes,
  styled,
} from "@mui/material";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";
import { updateProxiesProviders } from "tauri-plugin-mihomo-api";
import { BaseDialog } from "../base";

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const ProviderButton = () => {
  const { t } = useTranslation();
  const { data } = useSWR("getProxyProviders", calcuProxyProviders);

  const [open, setOpen] = useState(false);

  const hasProvider = Object.keys(data || {}).length > 0;
  const [updating, setUpdating] = useState(
    Object.keys(data || {}).map(() => false),
  );

  const setUpdatingAt = (status: boolean, index: number) => {
    setUpdating((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  };
  const handleUpdate = async (key: string, index: number) => {
    setUpdatingAt(true, index);
    updateProxiesProviders(key).finally(async () => {
      setUpdatingAt(false, index);
      await mutate("getProxies");
      await mutate("getProxyProviders");
    });
  };

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
              onClick={async () => {
                Object.entries(data || {}).forEach(
                  async ([key, item], index) => {
                    await handleUpdate(key, index);
                  },
                );
              }}>
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
        <div className="space-y-2">
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
                className="flex items-center rounded-sm bg-white p-2 shadow-sm dark:bg-[#282A36]">
                <div className="w-full overflow-hidden pr-4">
                  <div className="flex items-center">
                    <p className="text-primary-text text-xl font-bold">{key}</p>
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
                  onClick={() => handleUpdate(key, index)}
                  sx={{
                    ...(updating[index] && {
                      animation: `1s linear infinite ${round}`,
                    }),
                  }}>
                  <RefreshRounded />
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
