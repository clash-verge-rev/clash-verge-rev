import { BasePage } from "@/components/base";
import { ProviderButton } from "@/components/proxy/provider-button";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useLockFn, useMemoizedFn } from "ahooks";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { closeAllConnections } from "tauri-plugin-mihomo-api";

const ProxyPage = () => {
  const { t } = useTranslation();
  const { clashInfo, patchInfo, mutateInfo } = useClashInfo();
  const { verge } = useVerge();

  const modeList = ["rule", "global", "direct"];
  const curMode = clashInfo?.mode?.toLowerCase() ?? "rule";

  const onChangeMode = useMemoizedFn(
    useLockFn(async (mode: string) => {
      await patchInfo({ mode });
      mutateInfo();
      // 断开连接
      if (mode !== curMode && verge?.auto_close_connection) {
        closeAllConnections();
      }
    }),
  );

  useEffect(() => {
    if (curMode && !modeList.includes(curMode)) {
      onChangeMode("rule");
    }
  }, [curMode]);

  return (
    <BasePage
      full
      contentStyle={{ height: "100%" }}
      title={t("Proxy Groups")}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ProviderButton key={"provider"} />

          <ButtonGroup size="small">
            {modeList.map((mode) => (
              <Button
                key={mode}
                variant={mode === curMode ? "contained" : "outlined"}
                onClick={() => onChangeMode(mode)}
                sx={{ textTransform: "capitalize" }}>
                {t(mode)}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
      }>
      <ProxyGroups mode={curMode!} />
    </BasePage>
  );
};

export default ProxyPage;
