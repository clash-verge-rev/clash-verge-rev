import { useVerge } from "@/hooks/use-verge";
import { cn } from "@/utils";
import {
  alpha,
  Box,
  ListItem,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";

interface Props {
  to: string;
  children: string;
  icon: React.ReactNode[];
  open: boolean;
}
export const LayoutItem = (props: Props) => {
  const { to, children, icon, open } = props;
  const { verge } = useVerge();
  const matchRoute = useMatchRoute();
  const match = !!matchRoute({ to });
  const { menu_icon } = verge ?? {};
  const navigate = useNavigate();
  const enableMenuIcon = menu_icon && menu_icon !== "disable";

  return (
    <Tooltip
      title={enableMenuIcon && !open ? children : null}
      placement="right">
      <ListItem sx={{ py: 0.5, padding: "4px 0px", height: "60px" }}>
        <ListItemButton
          selected={!!match}
          sx={(theme) => {
            const color = theme.palette.primary.main;
            return {
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 10px",
              padding: "8px 6px",
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
          }}
          onClick={() => navigate({ to })}>
          <div
            className={cn("flex items-center text-center", { "w-full": open })}>
            <div className="flex h-8 w-full items-center justify-center">
              <motion.div layout className={cn({ "relative left-4": open })}>
                {enableMenuIcon && menu_icon === "monochrome" && (
                  <Box sx={{ color: match ? "primary.main" : "text.primary" }}>
                    {icon[0]}
                  </Box>
                )}
                {enableMenuIcon && menu_icon === "colorful" && icon[1]}
              </motion.div>
              {(open || !enableMenuIcon) && (
                <div className="w-full">
                  <Typography
                    sx={{
                      color: match ? "primary.main" : "text.primary",
                      fontWeight: "bold",
                    }}>
                    {children}
                  </Typography>
                </div>
              )}
            </div>
          </div>
        </ListItemButton>
      </ListItem>
    </Tooltip>
  );
};
