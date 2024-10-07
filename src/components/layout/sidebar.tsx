import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { LogoTitle } from "@/components/layout/logo-title";
import { useWindowSize } from "@/hooks/use-window-size";
import { routers } from "@/pages/_routers";
import { cn } from "@/utils";
import { List } from "@mui/material";
import { t } from "i18next";

interface Props {
  enableSystemTitle: boolean;
}

export const Sidebar = (props: Props) => {
  const { enableSystemTitle } = props;
  const { size } = useWindowSize();
  const open = size.width >= 650;

  return (
    <div
      className={cn(
        "flex flex-shrink-0 flex-grow-0 flex-col border-b-0 border-l-0 border-r border-t-0 border-solid border-[--divider-color] pt-2 transition-all duration-300 xs:basis-[110px] sm:basis-[200px]",
        {
          "pt-4": !enableSystemTitle,
        },
      )}>
      <LogoTitle />

      <List className="box-border flex-auto overflow-y-auto">
        {routers.map((router) => (
          <LayoutItem
            open={open}
            key={router.label}
            to={router.path}
            icon={router.icon}>
            {t(router.label)}
          </LayoutItem>
        ))}
      </List>

      <div className="flex flex-shrink-0 flex-grow-0 basis-[160px] items-center px-4 xs:hidden sm:block">
        <LayoutTraffic />
      </div>
    </div>
  );
};
