import { useVerge } from "@/hooks/use-verge";
import { cn } from "@/utils";
import getSystem from "@/utils/get-system";
import { LoadingButton } from "@mui/lab";
import { Button } from "@mui/material";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { t } from "i18next";
import { CSSProperties, ReactNode, useEffect, useRef } from "react";

const OS = getSystem();

interface AnimatedDialogProps {
  title: ReactNode;
  open: boolean;
  full?: boolean;
  fullWidth?: boolean;
  okBtn?: ReactNode;
  okDisabled?: boolean;
  cancelBtn?: ReactNode;
  hideOkBtn?: boolean;
  hideCancelBtn?: boolean;
  hideFooter?: boolean;
  contentStyle?: CSSProperties;
  children?: ReactNode;
  loading?: boolean;
  onOk?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
}

export interface DialogRef {
  open: () => void;
  close: () => void;
}

export const BaseDialog = (props: AnimatedDialogProps) => {
  const {
    title,
    open,
    full = false,
    fullWidth = false,
    okBtn = t("Confirm"),
    okDisabled = false,
    cancelBtn = t("Cancel"),
    hideOkBtn = false,
    hideCancelBtn = false,
    hideFooter = false,
    contentStyle,
    children,
    loading,
    onOk,
    onCancel,
    onClose,
  } = props;
  const { verge } = useVerge();
  const { enable_system_title_bar } = verge;
  const titlebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!titlebarRef.current || !full) return;
    titlebarRef.current?.addEventListener("mousedown", (e) => {
      if (e.buttons === 1) {
        // Primary (left) button
        const appWindow = getCurrentWindow();
        e.detail === 2
          ? appWindow.toggleMaximize() // Maximize on double click
          : appWindow.startDragging(); // Else start dragging
      }
    });
  }, [titlebarRef.current, full]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className={cn(
            "fixed inset-0 z-50 flex h-dvh items-center justify-center",
            { "bg-black/50": !full },
            {
              "rounded-md border-2 border-solid border-(--divider-color)":
                OS === "linux" && !enable_system_title_bar,
            },
          )}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: full ? 0 : 0.1 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage: "var(--mui-overlays-24)",
              ...contentStyle,
            }}
            className={cn(
              "bg-comment text-primary-text inline-flex max-h-[calc(100%-100px)] w-full max-w-md flex-col rounded-[4px] shadow-xl",
              { "h-full max-w-[calc(100%-100px)]": fullWidth },
              { "h-full max-h-full w-full max-w-full": full },
            )}>
            <div
              ref={titlebarRef}
              className="w-full px-6 py-4 text-xl font-bold">
              {title}
            </div>

            <div
              className={cn("h-full overflow-y-auto px-6", {
                "mb-6": hideFooter,
              })}>
              {children}
            </div>

            {!hideFooter && (
              <div className="my-4 flex justify-end !space-x-2 px-6">
                {!hideCancelBtn && (
                  <Button variant="outlined" onClick={onCancel}>
                    {cancelBtn}
                  </Button>
                )}
                {!hideOkBtn && (
                  <LoadingButton
                    disabled={okDisabled}
                    loading={loading}
                    variant="contained"
                    onClick={onOk}>
                    {okBtn}
                  </LoadingButton>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
