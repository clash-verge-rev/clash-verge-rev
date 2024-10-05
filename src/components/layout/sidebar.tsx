import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { LogoTitle } from "@/components/layout/logo-title";
import { useWindowSize } from "@/hooks/use-window-size";
import { routers } from "@/pages/_routers";
import { cn } from "@/utils";
import { List } from "@mui/material";
import { t } from "i18next";
import { useEffect, useState } from "react";

interface Props {
  enableSystemTitle: boolean;
}

export const Sidebar = (props: Props) => {
  const { enableSystemTitle } = props;
  const [open, setOpen] = useState(true);
  const { size } = useWindowSize();

  useEffect(() => {
    if (size.width < 700) {
      setOpen(false);
    } else {
      setOpen(true);
    }
  }, [size.width]);

  return (
    <div
      className={cn(
        "flex flex-shrink-0 flex-grow-0 basis-[200px] flex-col border-b-0 border-l-0 border-r border-t-0 border-solid border-[--divider-color] pt-2 transition-all duration-300",
        {
          "pt-4": !enableSystemTitle,
          "basis-[64px]": !open,
        },
      )}>
      <LogoTitle open={open} />

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

      {open && (
        <div className="flex flex-shrink-0 flex-grow-0 basis-[160px] items-center px-4">
          <LayoutTraffic />
        </div>
      )}
    </div>
  );
};
