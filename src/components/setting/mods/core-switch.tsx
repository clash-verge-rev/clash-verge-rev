import { mutate } from "swr";
import { useState } from "react";
import { useLockFn } from "ahooks";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { Settings } from "@mui/icons-material";
import { changeClashCore } from "@/services/cmds";
import { closeAllConnections } from "@/services/api";
import { useVerge } from "@/hooks/use-verge";
import { Notice } from "@/components/base";

const VALID_CORE = [
  { name: "Clash", core: "clash" },
  { name: "Clash Meta", core: "clash-meta" },
];

export const CoreSwitch = () => {
  const { verge, mutateVerge } = useVerge();

  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const { clash_core = "clash" } = verge ?? {};

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return;

    try {
      closeAllConnections();
      await changeClashCore(core);
      mutateVerge();
      setTimeout(() => {
        mutate("getClashConfig");
        mutate("getVersion");
      }, 100);
      setAnchorEl(null);
      Notice.success(`Successfully switch to ${core}`, 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  return (
    <>
      <IconButton
        color="inherit"
        size="small"
        onClick={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
        }}
      >
        <Settings
          fontSize="inherit"
          style={{ cursor: "pointer", opacity: 0.75 }}
        />
      </IconButton>

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorPosition={position}
        anchorReference="anchorPosition"
        transitionDuration={225}
        onContextMenu={(e) => {
          setAnchorEl(null);
          e.preventDefault();
        }}
      >
        {VALID_CORE.map((each) => (
          <MenuItem
            key={each.core}
            sx={{ minWidth: 125 }}
            selected={each.core === clash_core}
            onClick={() => onCoreChange(each.core)}
          >
            {each.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
