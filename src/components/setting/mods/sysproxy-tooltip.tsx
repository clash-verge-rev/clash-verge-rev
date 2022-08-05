import { useEffect, useState } from "react";
import { InfoRounded } from "@mui/icons-material";
import { ClickAwayListener, Tooltip } from "@mui/material";
import { getSystemProxy } from "@/services/cmds";

const SysproxyTooltip = () => {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<any>({});

  const onShow = async () => {
    const data = await getSystemProxy();
    setInfo(data ?? {});
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), 2000);
    return () => clearTimeout(timer);
  }, [open]);

  // todo: add error info
  const showTitle = (
    <div>
      <div>Enable: {(!!info.enable).toString()}</div>
      <div>Server: {info.server}</div>
      <div>Bypass: {info.bypass}</div>
    </div>
  );

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Tooltip
        PopperProps={{
          disablePortal: true,
        }}
        onClose={() => setOpen(false)}
        open={open}
        disableFocusListener
        disableHoverListener
        disableTouchListener
        placement="top"
        title={showTitle}
        arrow
      >
        <InfoRounded
          fontSize="small"
          style={{ cursor: "pointer", opacity: 0.75 }}
          onClick={onShow}
        />
      </Tooltip>
    </ClickAwayListener>
  );
};

export default SysproxyTooltip;
