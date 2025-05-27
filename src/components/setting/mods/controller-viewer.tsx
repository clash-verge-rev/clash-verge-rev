import { BaseDialog, DialogRef, SwitchLovely } from "@/components/base";
import { useNotice } from "@/components/base/notifice";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { Add, Remove, RotateLeft, Shuffle } from "@mui/icons-material";
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { nanoid } from "nanoid";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { GuardState } from "./guard-state";

const DEFAULT_ALLOW_ORIGINS = [
  "https://metacubex.github.io",
  "https://yacd.metacubex.one",
];

export const ControllerViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { notice } = useNotice();
  const { verge, patchVerge } = useVerge();
  const [open, setOpen] = useState(false);
  const { clashInfo, patchInfo } = useClashInfo();
  const { cors } = clashInfo || {};
  const { enable_external_controller = false } = verge;

  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(
    cors?.allow_private_network || false,
  );
  const [allowOrigins, setAllowOrigins] = useState<string[]>(
    cors?.allow_origins || [],
  );
  const [allowOriginsInput, setAllowOriginsInput] = useState("");

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setController(clashInfo?.server || "");
      setSecret(clashInfo?.secret || "");
    },
    close: () => setOpen(false),
  }));

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onError = (err: any) => {
    notice("error", err.message || err.toString());
  };

  const onSave = useLockFn(async () => {
    try {
      await patchInfo({
        "external-controller": controller,
        secret,
        "external-controller-cors": {
          "allow-private-network": allowPrivateNetwork,
          "allow-origins": allowOrigins,
        },
      });
      notice("success", t("External Controller Address Modified"), 1000);
      setOpen(false);
    } catch (err: any) {
      notice("error", err.message || err.toString(), 4000);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <div className="flex items-center justify-between">
          {t("External Controller")}
          <GuardState
            value={enable_external_controller}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onGuard={(e) => patchVerge({ enable_external_controller: e })}
            onSuccess={(v) => {
              if (v) {
                notice("success", t("External Controller Enabled"), 1000);
              } else {
                notice("success", t("External Controller Disabled"), 1000);
              }
            }}>
            <SwitchLovely edge="end" />
          </GuardState>
        </div>
      }
      contentStyle={{ maxWidth: 500, width: "fit-content", minWidth: 400 }}
      hideCancelBtn={!enable_external_controller}
      hideOkBtn={!enable_external_controller}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}>
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("External Controller Host")} />
          <TextField
            disabled={!enable_external_controller}
            size="small"
            autoComplete="off"
            sx={{ width: 175 }}
            value={controller}
            placeholder={t("Required")}
            onChange={(e) => setController(e.target.value)}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                }}>
                <span>{t("External Controller Secret")}</span>
                <IconButton
                  disabled={!enable_external_controller}
                  color="inherit"
                  size="small"
                  onClick={() => setSecret(nanoid())}>
                  <Shuffle fontSize="inherit" style={{ opacity: 0.75 }} />
                </IconButton>
              </Box>
            }
          />
          <TextField
            disabled={!enable_external_controller}
            size="small"
            autoComplete="off"
            sx={{ width: 175 }}
            value={secret}
            placeholder={t("Recommended")}
            onChange={(e) =>
              setSecret(e.target.value?.replace(/[^\x00-\x7F]/g, ""))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Allow Private Network")} />
          <SwitchLovely
            disabled={!enable_external_controller}
            checked={allowPrivateNetwork}
            onChange={(e) => {
              const value = e.target.checked;
              setAllowPrivateNetwork(value);
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={
              <Box sx={{ display: "flex", alignItems: "center" }}>
                {t("Allow Origins")}
                <Tooltip title={t("Reset Default Allow Origins")}>
                  <span>
                    <IconButton
                      disabled={!enable_external_controller}
                      color="primary"
                      size="small"
                      onClick={async () => {
                        setAllowOrigins(DEFAULT_ALLOW_ORIGINS);
                      }}>
                      <RotateLeft fontSize="inherit" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            }
          />
        </ListItem>

        <TextField
          disabled={!enable_external_controller}
          size="small"
          autoComplete="off"
          sx={{ width: "100%", padding: "5px 2px" }}
          value={allowOriginsInput}
          onChange={(e) => {
            const value = e.target.value;
            setAllowOriginsInput(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (allowOriginsInput.trim().length > 0) {
                if (allowOrigins.includes(allowOriginsInput)) {
                  setAllowOriginsInput("");
                  notice("warning", t("Duplicate Allow Origins"));
                } else {
                  setAllowOrigins((v) => [...v, allowOriginsInput.trim()]);
                  setAllowOriginsInput("");
                }
              }
            }
          }}
          slotProps={{
            input: {
              endAdornment: (
                <IconButton
                  disabled={!enable_external_controller}
                  color="primary"
                  size="small"
                  onClick={() => {
                    if (allowOriginsInput.trim().length > 0) {
                      if (allowOrigins.includes(allowOriginsInput)) {
                        setAllowOriginsInput("");
                        notice("warning", t("Duplicate Allow Origins"));
                      } else {
                        setAllowOrigins((v) => [
                          ...v,
                          allowOriginsInput.trim(),
                        ]);
                        setAllowOriginsInput("");
                      }
                    }
                  }}>
                  <Add fontSize="inherit" />
                </IconButton>
              ),
            },
          }}
        />
      </List>
      {allowOrigins.map((item) => {
        return (
          <ListItem
            key={item}
            sx={{
              padding: "8px",
              bgcolor: "var(--background-color-alpha)",
              margin: "5px 0",
            }}>
            <ListItemText primary={item} />
            <IconButton
              disabled={!enable_external_controller}
              size="small"
              color="warning"
              onClick={() => {
                setAllowOrigins((v) => v.filter((i) => i !== item));
              }}>
              <Remove fontSize="inherit" />
            </IconButton>
          </ListItem>
        );
      })}
    </BaseDialog>
  );
});
