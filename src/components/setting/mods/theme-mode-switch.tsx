import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { Button, ButtonGroup } from "@mui/material";
import { useTranslation } from "react-i18next";

type ThemeValue = IVergeConfig["theme_mode"];

interface Props {
  value?: ThemeValue;
  onChange?: (value: ThemeValue) => void;
}

export const ThemeModeSwitch = (props: Props) => {
  const { value, onChange } = props;
  const { t } = useTranslation();
  const { toggleTheme } = useCustomTheme();

  const modes = ["light", "dark", "system"] as const;

  return (
    <ButtonGroup size="small" sx={{ my: "4px" }}>
      {modes.map((mode) => (
        <Button
          key={mode}
          variant={mode === value ? "contained" : "outlined"}
          onClick={(e) => toggleTheme(e, mode)}
          sx={{ textTransform: "capitalize" }}>
          {t(`theme.${mode}`)}
        </Button>
      ))}
    </ButtonGroup>
  );
};
