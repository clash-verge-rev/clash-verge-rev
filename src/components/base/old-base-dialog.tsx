import { LoadingButton } from "@mui/lab";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  type SxProps,
  type Theme,
} from "@mui/material";
import { ReactNode } from "react";

interface Props {
  title: ReactNode;
  open: boolean;
  fullWidth?: boolean;
  okBtn?: ReactNode;
  cancelBtn?: ReactNode;
  disableOk?: boolean;
  disableCancel?: boolean;
  disableFooter?: boolean;
  contentSx?: SxProps<Theme>;
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

export const BaseDialog: React.FC<Props> = (props) => {
  const {
    open,
    fullWidth = false,
    title,
    children,
    okBtn,
    cancelBtn,
    contentSx,
    disableCancel,
    disableOk,
    disableFooter,
    loading,
  } = props;

  return (
    <Dialog open={open} onClose={props.onClose} fullWidth={fullWidth}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent sx={contentSx}>{children}</DialogContent>

      {!disableFooter && (
        <DialogActions>
          {!disableCancel && (
            <Button variant="outlined" onClick={props.onCancel}>
              {cancelBtn}
            </Button>
          )}
          {!disableOk && (
            <LoadingButton
              loading={loading}
              variant="contained"
              onClick={props.onOk}>
              {okBtn}
            </LoadingButton>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
};
