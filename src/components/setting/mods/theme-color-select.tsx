import { defaultDarkTheme, defaultTheme } from "@/pages/_theme";
import { useThemeMode, useThemeSettings } from "@/services/states";
import { useDebounce } from "ahooks";
import { useEffect, useState } from "react";

type ThemeKey =
  | "primary_color"
  | "secondary_color"
  | "primary_text"
  | "secondary_text"
  | "info_color"
  | "error_color"
  | "warning_color"
  | "success_color";

interface Props {
  label: string;
  themeKey: ThemeKey;
}

const ThemeColorSelect = (props: Props) => {
  const { label, themeKey } = props;
  const [themeSettings, setThemeSettings] = useThemeSettings();
  const themeMode = useThemeMode();
  const theme =
    (themeMode === "light" ? themeSettings.light : themeSettings.dark) ?? {};
  const dt = themeMode === "light" ? defaultTheme : defaultDarkTheme;
  const [color, setColor] = useState<string>(theme[themeKey] || dt[themeKey]);
  const debounceValue = useDebounce(color, { wait: 300 });

  useEffect(() => {
    setColor(theme[themeKey] || dt[themeKey]);
  }, [theme, dt]);

  useEffect(() => {
    setThemeSettings((prev: any) => ({
      ...prev,
      [themeMode]: {
        ...prev[themeMode],
        [themeKey]: debounceValue,
      },
    }));
  }, [debounceValue]);

  return (
    <div className="my-1 flex h-12 items-center justify-between px-1 text-primary">
      <p className="text-lg">{label}</p>
      <div className="flex w-[150px] items-center justify-between">
        <input
          className="background-transparent cursor-pointer border-none outline-none"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <p className="text-gray-400">{color}</p>
      </div>
    </div>
  );
};

export default ThemeColorSelect;
