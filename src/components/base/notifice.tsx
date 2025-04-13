import { Close } from "@mui/icons-material";
import { nanoid } from "nanoid";
import { BaseVariant, useSnackbar } from "notistack";
import { createContext, useContext } from "react";

const NoticeContext = createContext<
  | {
      notice: (type: BaseVariant, message: string, duration?: number) => void;
    }
  | undefined
>(undefined);

export const NoticeProvider = ({ children }: { children: React.ReactNode }) => {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const notice = (
    type: BaseVariant = "default",
    message: string,
    duration: number = 3000,
  ) => {
    const key = nanoid();
    enqueueSnackbar(message, {
      key,
      variant: type,
      autoHideDuration: duration,
      anchorOrigin: { vertical: "top", horizontal: "right" },
      style: {
        maxWidth: "500px",
        overflowWrap: "break-word",
        wordWrap: "break-word",
        textWrap: "wrap",
      },
      action: (
        <div className="text-white" onClick={() => closeSnackbar(key)}>
          <Close fontSize="small" />
        </div>
      ),
    });
  };
  return <NoticeContext value={{ notice }}>{children}</NoticeContext>;
};

export const useNotice = () => {
  const context = useContext(NoticeContext);
  if (!context) {
    throw new Error("useNotice must be used within a NoticeContext");
  }
  return context;
};
