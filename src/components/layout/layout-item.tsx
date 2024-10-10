import { useVerge } from "@/hooks/use-verge";
import { cn } from "@/utils";
import {
  alpha,
  IconButton,
  ListItem,
  ListItemButton,
  Tooltip,
} from "@mui/material";
import { motion } from "framer-motion";
import { useMatch, useNavigate, useResolvedPath } from "react-router-dom";
interface Props {
  to: string;
  children: string;
  icon: React.ReactNode[];
  open: boolean;
}
export const LayoutItem = (props: Props) => {
  const { to, children, icon, open } = props;
  const { verge } = useVerge();
  const { menu_icon } = verge ?? {};
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });
  const navigate = useNavigate();
  const enableMenuIcon = menu_icon && menu_icon !== "disable";

  return (
    <Tooltip
      title={enableMenuIcon && !open ? children : null}
      placement="right">
      <ListItem sx={{ py: 0.5, padding: "4px 0px", height: "60px" }}>
        <ListItemButton
          selected={!!match}
          sx={[
            {
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 10px",
              padding: "8px 6px",
            },
            (theme) => {
              const color = theme.palette.primary.main;
              return {
                "& .MuiListItemText-primary": {
                  color: theme.palette.text.primary,
                  fontWeight: "700",
                },
                "& .MuiListItemIcon-root": {
                  color: theme.palette.text.primary,
                },
                // 涟漪效果颜色
                "& .MuiTouchRipple-root .MuiTouchRipple-rippleVisible": {
                  color,
                },
                "&.Mui-selected": { bgcolor: alpha(color, 0.25) },
                ...theme.applyStyles("dark", {
                  "&.Mui-selected": { bgcolor: alpha(color, 0.35) },
                }),
                "&.Mui-selected:hover": { bgcolor: alpha(color, 0.25) },
                ...theme.applyStyles("dark", {
                  "&.Mui-selected:hover": { bgcolor: alpha(color, 0.35) },
                }),
                "&.Mui-selected .MuiListItemText-primary": { color },
                "&.Mui-selected .MuiListItemIcon-root": { color },
              };
            },
          ]}
          onClick={() => navigate(to)}>
          <div
            className={cn("flex items-center text-center", { "w-full": open })}>
            <div className="flex w-full items-center justify-center">
              <motion.div layout className={cn({ "mr-8": open })}>
                {enableMenuIcon && menu_icon === "monochrome" && (
                  <IconButton
                    sx={{ color: match ? "primary.main" : "text.primary" }}
                    size="small">
                    {icon[0]}
                  </IconButton>
                )}
                {enableMenuIcon && menu_icon === "colorful" && (
                  <IconButton className="m-0 p-0" size="small">
                    {icon[1]}
                  </IconButton>
                )}
              </motion.div>
              {(open || !enableMenuIcon) && (
                <motion.span
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className={cn("font-bold", {
                    "text-primary-main": match,
                    "text-text": !match,
                  })}>
                  {children}
                </motion.span>
              )}
            </div>
          </div>
        </ListItemButton>
      </ListItem>
    </Tooltip>
  );
};
