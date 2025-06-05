import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { LogoTitle } from "@/components/layout/logo-title";
import { useWindowSize } from "@/hooks/use-window-size";
import { routes } from "@/routes/__root";
import { cn } from "@/utils";
import { List } from "@mui/material";
import { useTranslation } from "react-i18next";
import { LayoutItem } from "./layout-item";

interface Props {
  enableSystemTitleBar: boolean;
}

export const Sidebar = (props: Props) => {
  const { enableSystemTitleBar } = props;
  const { size } = useWindowSize();
  const { t } = useTranslation();
  const open = size.width >= 650;

  return (
    <div
      className={cn(
        "relative flex shrink-0 grow-0 basis-[200px] flex-col border-t-0 border-r border-b-0 border-l-0 border-solid border-(--divider-color) pt-2 transition-all duration-300",
        {
          "basis-[110px]": !open,
          "pt-4": !enableSystemTitleBar,
        },
      )}>
      <LogoTitle open={open} />

      <div
        className={cn("absolute top-0 right-0 left-0 h-[80px] bg-transparent", {
          "h-[90px]": !open,
          "h-[70px]": enableSystemTitleBar && open,
          "h-[85px]": enableSystemTitleBar && !open,
        })}
        data-tauri-drag-region="true"></div>

      <List className="box-border flex-auto overflow-y-auto">
        {routes.map((route) => (
          <LayoutItem
            open={open}
            key={route.label}
            to={route.path}
            icon={route.icon}>
            {t(route.label)}
          </LayoutItem>
        ))}
      </List>

      <div
        className={cn(
          "flex shrink-0 grow-0 items-center justify-center px-4 py-2",
          { hidden: !open },
        )}>
        <LayoutTraffic />
      </div>
    </div>
  );
};
