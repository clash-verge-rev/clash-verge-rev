import { cn } from "@/utils";
import { Link, Tooltip, Typography } from "@mui/material";
import { useMemo, useState } from "react";

interface Props {
  groupNameList: string[];
  onGroupNameClick?: (groupName: string) => void;
  className?: string;
}

type GroupName = {
  name: string;
  shortName: string;
};

export const ProxyGroupSidebar = (props: Props) => {
  const { groupNameList, onGroupNameClick, className } = props;
  const [open, setOpen] = useState(false);
  const groupNameListWithShortName: GroupName[] = useMemo(() => {
    return groupNameList.map((name) => {
      let shortName = name.substring(0, 4);
      const regex = RegExp(/^.*[\u4e00-\u9fa5a-zA-Z0-9\s]+$/);
      if (regex.test(shortName)) {
        shortName = name.substring(0, 2);
        if (regex.test(shortName)) {
          shortName = name.substring(0, 1);
        }
      }
      return { name, shortName };
    });
  }, [groupNameList]);

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        "flex h-full w-full flex-col items-center justify-center bg-white text-center text-sm dark:bg-[#282A36]",
        className,
      )}>
      <div className="no-scrollbar hover:scrollbar w-full !space-y-2 overflow-auto px-1 py-2">
        {groupNameListWithShortName.map((item) => (
          <Tooltip title={item.name} key={item.name} placement="left">
            <Link
              underline="hover"
              className="text-primary-text hover:text-secondary-text line-clamp-1 cursor-pointer"
              onClick={() => onGroupNameClick && onGroupNameClick(item.name)}>
              <Typography variant="body2">
                {open ? item.name : item.shortName}
              </Typography>
            </Link>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};
