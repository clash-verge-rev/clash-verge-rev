import { cn } from "@/utils";
import { Link } from "@mui/material";
import { useState } from "react";

interface Props {
  groupNameList: string[];
  onClickGroupName?: (groupName: string) => void;
  className?: string;
}

export const ProxyGroupSidebar = (props: Props) => {
  const { groupNameList, onClickGroupName, className } = props;
  const [open, setOpen] = useState(false);
  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className={cn(
        "box-border flex h-full w-full flex-col items-center justify-center overflow-y-auto scroll-smooth bg-white p-4 text-start text-sm dark:bg-[#282A36]",
        className,
      )}>
      {groupNameList.map((name) => (
        <Link
          key={name}
          underline="hover"
          className="line-clamp-1 cursor-pointer text-primary hover:text-secondary"
          onClick={() => onClickGroupName && onClickGroupName(name)}>
          {open ? name : [...name][0]}
        </Link>
      ))}
    </div>
  );
};
