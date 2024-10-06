import { cn } from "@/utils";
import { Link } from "@mui/material";

interface Props {
  groupNameList: string[];
  onClickGroupName?: (groupName: string) => void;
  className?: string;
}

export const ProxyGroupSidebar = (props: Props) => {
  const { groupNameList, onClickGroupName, className } = props;
  return (
    <div
      className={cn(
        "box-border flex h-full w-full flex-col items-center gap-2 overflow-auto scroll-smooth bg-white p-4 text-center text-sm dark:bg-[#282A36]",
        className,
      )}
      style={{
        scrollbarWidth: "thin",
      }}>
      {groupNameList.map((name) => (
        <Link
          underline="hover"
          className="cursor-pointer text-primary hover:text-secondary"
          onClick={() => onClickGroupName && onClickGroupName(name)}>
          {name}
        </Link>
      ))}
    </div>
  );
};
