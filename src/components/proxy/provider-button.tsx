import dayjs from "dayjs";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  styled,
  Box,
  alpha,
  Typography,
  Divider,
  LinearProgress,
  keyframes,
} from "@mui/material";
import { RefreshRounded } from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import { getProxyProviders, proxyProviderUpdate } from "@/services/api";
import { BaseDialog } from "../base";
import parseTraffic from "@/utils/parse-traffic";

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const ProviderButton = () => {
  const { t } = useTranslation();
  const { data } = useSWR("getProxyProviders", getProxyProviders);

  const [open, setOpen] = useState(false);

  const hasProvider = Object.keys(data || {}).length > 0;
  const [updating, setUpdating] = useState(
    Object.keys(data || {}).map(() => false)
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
    proxyProviderUpdate(key)
      .then(async () => {
        setUpdatingAt(false, index);
        await mutate("getProxies");
        await mutate("getProxyProviders");
      })
      .catch(async () => {
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
        onClick={() => setOpen(true)}
      >
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
                Object.entries(data || {}).forEach(async ([key], index) => {
                  await handleUpdate(key, index);
                });
              }}
            >
              {t("Update All")}
            </Button>
          </Box>
        }
        contentSx={{ width: 400 }}
        disableOk
        cancelBtn={t("Close")}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <List sx={{ py: 0, minHeight: 250 }}>
          {Object.entries(data || {}).map(([key, item], index) => {
            const time = dayjs(item.updatedAt);
            const sub = item.subscriptionInfo;
            const hasSubInfo = !!sub;
            const upload = sub?.Upload || 0;
            const download = sub?.Download || 0;
            const total = sub?.Total || 0;
            const expire = sub?.Expire || 0;
            const progress = Math.min(
              Math.round(((download + upload) * 100) / (total + 0.01)) + 1,
              100
            );
            return (
              <>
                <ListItem
                  sx={{
                    p: 0,
                    borderRadius: "10px",
                    border: "solid 2px var(--divider-color)",
                    mb: 1,
                  }}
                  key={key}
                >
                  <ListItemText
                    sx={{ px: 1 }}
                    primary={
                      <>
                        <Typography
                          variant="h6"
                          component="span"
                          noWrap
                          title={key}
                        >
                          {key}
                        </Typography>
                        <TypeBox component="span" sx={{ marginLeft: "8px" }}>
                          {item.proxies.length}
                        </TypeBox>
                      </>
                    }
                    secondary={
                      <>
                        <StyledTypeBox component="span">
                          {item.vehicleType}
                        </StyledTypeBox>
                        <StyledTypeBox component="span">
                          {t("Update At")} {time.fromNow()}
                        </StyledTypeBox>
                        {hasSubInfo && (
                          <>
                            <Box sx={{ ...boxStyle, fontSize: 14 }}>
                              <span title="Used / Total">
                                {parseTraffic(upload + download)} /{" "}
                                {parseTraffic(total)}
                              </span>
                              <span title="Expire Time">
                                {parseExpire(expire)}
                              </span>
                            </Box>

                            <LinearProgress
                              variant="determinate"
                              value={progress}
                              style={{ opacity: total > 0 ? 1 : 0 }}
                            />
                          </>
                        )}
                      </>
                    }
                  />
                  <Divider orientation="vertical" flexItem />
                  <IconButton
                    size="small"
                    color="inherit"
                    title={`${t("Update")}${t("Proxy Provider")}`}
                    onClick={() => handleUpdate(key, index)}
                    sx={{
                      animation: updating[index]
                        ? `1s linear infinite ${round}`
                        : "none",
                    }}
                  >
                    <RefreshRounded />
                  </IconButton>
                </ListItem>
              </>
            );
          })}
        </List>
      </BaseDialog>
    </>
  );
};
const TypeBox = styled(Box)<{ component?: React.ElementType }>(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.secondary.main, 0.5),
  color: alpha(theme.palette.secondary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

const StyledTypeBox = styled(Box)<{ component?: React.ElementType }>(
  ({ theme }) => ({
    display: "inline-block",
    border: "1px solid #ccc",
    borderColor: alpha(theme.palette.primary.main, 0.5),
    color: alpha(theme.palette.primary.main, 0.8),
    borderRadius: 4,
    fontSize: 10,
    marginRight: "4px",
    padding: "0 2px",
    lineHeight: 1.25,
  })
);

const boxStyle = {
  height: 26,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}
