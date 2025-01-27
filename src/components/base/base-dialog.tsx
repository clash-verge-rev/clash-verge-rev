import { useVerge } from "@/hooks/use-verge";
import { cn } from "@/utils";
import getSystem from "@/utils/get-system";
import { LoadingButton } from "@mui/lab";
import { Button } from "@mui/material";
import { AnimatePresence, motion } from "framer-motion";
import { t } from "i18next";
import { CSSProperties, ReactNode } from "react";

const OS = getSystem();

interface AnimatedDialogProps {
  title: ReactNode;
  open: boolean;
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
            "fixed inset-0 z-50 flex h-dvh items-center justify-center bg-black bg-opacity-50",
            { "rounded-md": OS === "linux" && !enable_system_title_bar },
          )}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.1 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage: "var(--mui-overlays-24)",
              ...contentStyle,
            }}
            className={cn(
              "inline-flex max-h-[calc(100%-100px)] w-full max-w-md flex-col rounded-[4px] bg-[var(--mui-palette-background-paper)] text-primary shadow-xl",
              { "max-w-[calc(100%-100px)]": fullWidth },
            )}>
            <div className="my-4 px-6 text-xl font-bold">{title}</div>

            <div
              className={cn("h-full overflow-y-auto px-6", {
                "mb-6": hideFooter,
              })}>
              {children}
            </div>

            {!hideFooter && (
              <div className="my-4 flex justify-end space-x-2 px-6">
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
