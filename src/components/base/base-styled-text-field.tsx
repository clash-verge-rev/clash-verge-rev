import { TextField, type TextFieldProps, styled } from "@mui/material";
import { useTranslation } from "react-i18next";

export const BaseStyledTextField = styled((props: TextFieldProps) => {
  const { t } = useTranslation();

  return (
    <TextField
      hiddenLabel
      fullWidth
      size="small"
      autoComplete="off"
      variant="outlined"
      spellCheck="false"
      placeholder={t("Filter conditions")}
      sx={{ input: { py: 0.65, px: 1.25 } }}
      {...props}
    />
  );
})(({ theme }) => ({
  ...(theme.palette.mode === "light" && { backgroundColor: "#fff" }),
}));
