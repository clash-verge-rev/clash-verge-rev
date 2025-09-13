import { cn } from "@/utils";
import Cancel from "@mui/icons-material/Cancel";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Warning from "@mui/icons-material/Warning";
import Info from "@mui/icons-material/Info";
import Close from "@mui/icons-material/Close";
import { ThemeProvider } from "@mui/material";
import IconButton from "@mui/material/IconButton";
import { CustomContentProps, SnackbarContent, useSnackbar } from "notistack";
import { ForwardedRef, useCallback } from "react";
import { useCustomTheme } from "../layout/use-custom-theme";
import { CopyButton } from "./copy-button";

type MyNoticeContainerProps = CustomContentProps & {
  ref: ForwardedRef<HTMLDivElement>;
};

export const MyNoticeContainer = (props: MyNoticeContainerProps) => {
  const { ref, id, variant, message } = props;
  const { theme } = useCustomTheme();
  const { closeSnackbar } = useSnackbar();

  const handleDismiss = useCallback(() => {
    closeSnackbar(id);
  }, [id, closeSnackbar]);

  const icons = {
    default: CheckCircle,
    success: CheckCircle,
    info: Info,
    warning: Warning,
    error: Cancel,
  };
  const Icon = icons[variant];

  return (
    <ThemeProvider theme={theme}>
      <SnackbarContent
        ref={ref}
        className="max-w-[500px] overflow-hidden rounded-md shadow-xl">
        <div
          className={cn("flex w-full items-center p-3", {
            "bg-[#313131] dark:bg-[#4B4B4B]": variant === "default",
            "bg-[#43A047] dark:bg-[#16681B]": variant === "success",
            "bg-[#2196F3] dark:bg-[#0B5E9E]": variant === "info",
            "bg-[#FF9800] dark:bg-[#A66300]": variant === "warning",
            "bg-[#D32F2F] dark:bg-[#890F0F]": variant === "error",
          })}>
          <div className="flex w-full items-center overflow-hidden">
            {variant !== "default" && <Icon className="!fill-white" />}
            <div className="mx-4 w-full overflow-hidden text-wrap break-words text-white">
              {message}
            </div>
            <div className="flex items-center">
              <CopyButton
                size="small"
                className="!text-white"
                content={message as string}
              />
              <IconButton size="small" onClick={handleDismiss}>
                <Close fontSize="small" className="!fill-white" />
              </IconButton>
            </div>
          </div>
        </div>
      </SnackbarContent>
    </ThemeProvider>
  );
};

MyNoticeContainer.displayName = "MyNoticeContainer";
