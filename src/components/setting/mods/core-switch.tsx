import useSWR, { useSWRConfig } from "swr";
import { useState } from "react";
import { useLockFn } from "ahooks";
import { Menu, MenuItem } from "@mui/material";
import { Settings } from "@mui/icons-material";
import { changeClashCore, getVergeConfig } from "@/services/cmds";
import Notice from "@/components/base/base-notice";

const VALID_CORE = [
  { name: "Clash", core: "clash" },
  { name: "Clash Meta", core: "clash-meta" },
];

const CoreSwitch = () => {
  const { mutate } = useSWRConfig();

  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const { clash_core = "clash" } = vergeConfig ?? {};

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return;

    try {
      await changeClashCore(core);
      mutate("getVergeConfig");
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
      <Settings
        fontSize="small"
        style={{ cursor: "pointer", opacity: 0.75 }}
        onClick={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
        }}
      />

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

export default CoreSwitch;
