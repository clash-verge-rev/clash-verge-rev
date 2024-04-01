import { useTranslation } from "react-i18next";
import { Button, ButtonGroup, Tooltip } from "@mui/material";
import { checkService } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import getSystem from "@/utils/get-system";
import useSWR from "swr";

const isWIN = getSystem() === "windows";

interface Props {
  value?: string;
  onChange?: (value: string) => void;
}

export const StackModeSwitch = (props: Props) => {
  const { value, onChange } = props;
  const { verge } = useVerge();
  const { enable_service_mode } = verge ?? {};
  // service mode
  const { data: serviceStatus } = useSWR(
    isWIN ? "checkService" : null,
    checkService,
    {
      revalidateIfStale: false,
      shouldRetryOnError: false,
    }
  );

  const { t } = useTranslation();

  return (
    <Tooltip
      title={
        isWIN && (serviceStatus !== "active" || !enable_service_mode)
          ? t("System and Mixed Can Only be Used in Service Mode")
          : ""
      }
    >
      <ButtonGroup size="small" sx={{ my: "4px" }}>
        <Button
          variant={value?.toLowerCase() === "system" ? "contained" : "outlined"}
          onClick={() => onChange?.("system")}
          disabled={
            isWIN && (serviceStatus !== "active" || !enable_service_mode)
          }
          sx={{ textTransform: "capitalize" }}
        >
          System
        </Button>
        <Button
          variant={value?.toLowerCase() === "gvisor" ? "contained" : "outlined"}
          onClick={() => onChange?.("gvisor")}
          sx={{ textTransform: "capitalize" }}
        >
          gVisor
        </Button>

        <Button
          variant={value?.toLowerCase() === "mixed" ? "contained" : "outlined"}
          onClick={() => onChange?.("mixed")}
          disabled={
            isWIN && (serviceStatus !== "active" || !enable_service_mode)
          }
          sx={{ textTransform: "capitalize" }}
        >
          Mixed
        </Button>
      </ButtonGroup>
    </Tooltip>
  );
};
