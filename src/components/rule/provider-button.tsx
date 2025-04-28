import { BaseDialog } from "@/components/base";
import { calcuRuleProviders } from "@/services/api";
import { cn } from "@/utils";
import { Error, RefreshRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  IconButton,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";
import { updateRuleProvider } from "tauri-plugin-mihomo-api";

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
    try {
      await updateRuleProvider(key);
      setErrorItems((pre) => {
        if (pre?.includes(key)) {
          return pre.filter((item) => item !== key);
        }
        return pre;
      });
    } catch (e: any) {
      if (retryCount < 0) {
        setErrorItems((pre) => {
          if (pre?.includes(key)) {
            return pre;
          }
          return [...pre, key];
        });
      } else {
        // retry after 1 second
        setTimeout(async () => {
          await handleUpdate(key, index, retryCount - 1);
        }, 1000);
      }
    } finally {
      setUpdatingAt(false, index);
      await mutate("getRules");
      await mutate("getRuleProviders");
    }
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
        <div>
          {entries.map(([key, item], index) => {
            const time = dayjs(item.updatedAt);
            const error = errorItems?.includes(key);
            return (
              <div
                key={key}
                className="mb-2 flex items-center rounded-sm bg-white p-2 shadow-sm dark:bg-[#282A36]">
                <div className="w-full overflow-hidden">
                  <div className="flex items-center">
                    {error && (
                      <Error
                        color="error"
                        fontSize="small"
                        sx={{ marginRight: "8px" }}
                      />
                    )}
                    <p className="text-primary-text text-xl">{key}</p>
                    <TypeSpan sx={{ marginLeft: "8px" }}>
                      {item.ruleCount}
                    </TypeSpan>
                  </div>
                  <StyledTypeSpan>{item.vehicleType}</StyledTypeSpan>
                  <StyledTypeSpan>{item.behavior}</StyledTypeSpan>
                  <StyledTypeSpan>
                    {t("Update At")} {time.fromNow()}
                  </StyledTypeSpan>
                </div>
                <Divider orientation="vertical" flexItem />
                <IconButton
                  size="small"
                  color="inherit"
                  title={`${t("Update")}${t("Rule Provider")}`}
                  onClick={() => handleUpdate(key, index)}>
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
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

const StyledTypeSpan = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: "4px",
  fontSize: "10px",
  marginRight: "4px",
  padding: "0 2px",
}));
