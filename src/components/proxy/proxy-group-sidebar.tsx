import { cn } from "@/utils";
import { Link, Tooltip, Typography } from "@mui/material";
import { useState } from "react";

interface Props {
  groupNameList: string[];
  onGroupNameClick?: (groupName: string) => void;
  className?: string;
}

export const ProxyGroupSidebar = (props: Props) => {
  const { groupNameList, onGroupNameClick, className } = props;
  const [open, setOpen] = useState(false);

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        "flex h-full w-full flex-col items-center justify-center bg-white text-center text-sm dark:bg-[#282A36]",
        className,
      )}>
      <div className="no-scrollbar hover:scrollbar w-full space-y-2 overflow-auto px-1 py-2">
        {groupNameList.map((name) => (
          <Tooltip title={name} key={name} placement="left">
            <Link
              underline="hover"
              className="line-clamp-1 cursor-pointer text-primary hover:text-secondary"
              onClick={() => onGroupNameClick && onGroupNameClick(name)}>
              <Typography variant="body2">
                {open ? name : [...name][0]}
              </Typography>
            </Link>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};
