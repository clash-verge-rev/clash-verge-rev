import { BaseDialog, Notice } from "@/components/base";
import { calcuRuleProviders } from "@/services/api";
import { Error, RefreshRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
  alpha,
  keyframes,
  styled,
} from "@mui/material";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";
import { updateRulesProviders } from "tauri-plugin-mihomo-api";

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const ProviderButton = () => {
  const { t } = useTranslation();
  const { data } = useSWR("getRuleProviders", calcuRuleProviders);
  const entries = Object.entries(data || {});
  const keys = entries.map(([key]) => key);

  const [open, setOpen] = useState(false);

  const hasProvider = keys.length > 0;
  const [updating, setUpdating] = useState(keys.map(() => false));
  const [errorItems, setErrorItems] = useState<string[]>([]);

  const setUpdatingAt = (status: boolean, index: number) => {
    setUpdating((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  };

  const handleUpdate = async (key: string, index: number, retryCount = 5) => {
    setUpdatingAt(true, index);
    updateRulesProviders(key)
      .then(async () => {
        setErrorItems((pre) => {
          if (pre?.includes(key)) {
            return pre.filter((item) => item !== key);
          }
          return pre;
        });
        setUpdatingAt(false, index);
        await mutate("getRules");
        await mutate("getRuleProviders");
      })
      .catch(async (e: any) => {
        if (retryCount > 0) {
          // retry after 1 second
          setTimeout(async () => {
            await handleUpdate(key, index, retryCount - 1);
          }, 1000);
        } else {
          Notice.error(
            t("Update Rule Provider Error", {
              name: `${key}`,
              errorMsg: e.message,
            }),
          );
          setErrorItems((pre) => {
            if (pre?.includes(key)) {
              return pre;
            }
            return [...pre, key];
          });
          setUpdatingAt(false, index);
          await mutate("getRules");
          await mutate("getRuleProviders");
        }
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
        {t("Rule Provider")}
      </Button>

      <BaseDialog
        open={open}
        title={
          <Box display="flex" justifyContent={"space-between"} gap={1}>
            <Box display={"flex"} alignItems={"center"}>
              <Typography variant="h6">{t("Rule Provider")}</Typography>
              <TypeSpan sx={{ ml: 1, fontSize: 14 }}>{entries.length}</TypeSpan>
            </Box>
            <Button
              variant="contained"
              size="small"
              onClick={async () => {
                entries.forEach(async ([key, item], index) => {
                  await handleUpdate(key, index);
                });
              }}>
              {t("Update All")}
            </Button>
          </Box>
        }
        contentStyle={{ width: 400 }}
        hideOkBtn
        hideCancelBtn
        onClose={() => setOpen(false)}>
        <List sx={{ py: 0, minHeight: 250 }}>
          {entries.map(([key, item], index) => {
            const time = dayjs(item.updatedAt);
            const error = errorItems?.includes(key);
            return (
              <ListItem
                sx={(theme) => ({
                  p: 1,
                  borderRadius: "6px",
                  bgcolor: "white",
                  mb: 1,
                  ...theme.applyStyles("dark", {
                    bgcolor: "#282A36",
                  }),
                })}
                key={key}>
                <ListItemText
                  sx={{ px: 1 }}
                  primary={
                    <Box display={"flex"} alignItems={"center"}>
                      {error && (
                        <Error
                          color="error"
                          fontSize="small"
                          sx={{ marginRight: "8px" }}
                        />
                      )}
                      <Typography
                        variant="h6"
                        color={error ? "error" : "inherit"}
                        noWrap
                        title={key}>
                        {key}
                      </Typography>
                      <TypeSpan sx={{ marginLeft: "8px" }}>
                        {item.ruleCount}
                      </TypeSpan>
                    </Box>
                  }
                  secondary={
                    <>
                      <StyledTypeSpan>{item.vehicleType}</StyledTypeSpan>
                      <StyledTypeSpan>{item.behavior}</StyledTypeSpan>
                      <StyledTypeSpan>
                        {t("Update At")} {time.fromNow()}
                      </StyledTypeSpan>
                    </>
                  }
                />
                <Divider orientation="vertical" flexItem />
                <IconButton
                  size="small"
                  color="inherit"
                  title={`${t("Update")}${t("Rule Provider")}`}
                  onClick={() => handleUpdate(key, index)}
                  sx={{
                    animation: updating[index]
                      ? `1s linear infinite ${round}`
                      : "none",
                  }}>
                  <RefreshRounded />
                </IconButton>
              </ListItem>
            );
          })}
        </List>
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
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

const StyledTypeSpan = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));
