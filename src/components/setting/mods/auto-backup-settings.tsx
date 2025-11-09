import {
  FormControl,
  InputLabel,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/noticeService";

const INTERVAL_OPTIONS = [1, 6, 12, 24, 72, 168];

interface AutoBackupState {
  scheduleEnabled: boolean;
  intervalHours: number;
  changeEnabled: boolean;
}

export function AutoBackupSettings() {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();
  const derivedValues = useMemo<AutoBackupState>(() => {
    return {
      scheduleEnabled: verge?.enable_auto_backup_schedule ?? false,
      intervalHours: verge?.auto_backup_interval_hours ?? 24,
      changeEnabled: verge?.auto_backup_on_change ?? true,
    };
  }, [
    verge?.enable_auto_backup_schedule,
    verge?.auto_backup_interval_hours,
    verge?.auto_backup_on_change,
  ]);
  const [pendingValues, setPendingValues] = useState<AutoBackupState | null>(
    null,
  );
  const values = pendingValues ?? derivedValues;

  const applyPatch = useLockFn(
    async (
      partial: Partial<AutoBackupState>,
      payload: Partial<IVergeConfig>,
    ) => {
      const nextValues = { ...values, ...partial };
      setPendingValues(nextValues);
      try {
        await patchVerge(payload);
        setPendingValues(null);
      } catch (error) {
        showNotice.error(error);
        setPendingValues(null);
      }
    },
  );

  const disabled = !verge;

  const formatIntervalLabel = (value: number) => {
    if (value % 24 === 0) {
      return t("settings.modals.backup.auto.options.days", {
        n: Math.max(1, Math.round(value / 24)),
      });
    }
    return t("settings.modals.backup.auto.options.hours", { n: value });
  };

  const handleScheduleToggle = (
    _: React.ChangeEvent<HTMLInputElement>,
    checked: boolean,
  ) => {
    applyPatch(
      { scheduleEnabled: checked },
      {
        enable_auto_backup_schedule: checked,
        auto_backup_interval_hours: values.intervalHours,
      },
    );
  };

  const handleIntervalChange = (event: SelectChangeEvent<number>) => {
    const nextValue = Number(event.target.value);
    applyPatch(
      { intervalHours: nextValue },
      { auto_backup_interval_hours: nextValue },
    );
  };

  const handleChangeToggle = (
    _: React.ChangeEvent<HTMLInputElement>,
    checked: boolean,
  ) => {
    applyPatch({ changeEnabled: checked }, { auto_backup_on_change: checked });
  };

  const intervalLabelId = "auto-backup-interval-label";

  return (
    <Fragment>
      <ListItem divider disableGutters>
        <Stack direction="row" alignItems="center" spacing={1} width="100%">
          <ListItemText
            primary={t("settings.modals.backup.auto.scheduleLabel")}
            secondary={t("settings.modals.backup.auto.scheduleHelper")}
          />
          <Switch
            edge="end"
            checked={values.scheduleEnabled}
            onChange={handleScheduleToggle}
            disabled={disabled}
          />
        </Stack>
      </ListItem>

      <ListItem divider disableGutters>
        <Stack direction="row" alignItems="center" spacing={2} width="100%">
          <ListItemText
            primary={t("settings.modals.backup.auto.intervalLabel")}
          />
          <FormControl
            size="small"
            disabled={disabled || !values.scheduleEnabled}
            sx={{ minWidth: 160 }}
          >
            <InputLabel id={intervalLabelId}>
              {t("settings.modals.backup.auto.intervalLabel")}
            </InputLabel>
            <Select
              labelId={intervalLabelId}
              label={t("settings.modals.backup.auto.intervalLabel")}
              value={values.intervalHours}
              onChange={handleIntervalChange}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {formatIntervalLabel(option)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </ListItem>

      <ListItem divider disableGutters>
        <Stack direction="row" alignItems="center" spacing={1} width="100%">
          <ListItemText
            primary={t("settings.modals.backup.auto.changeLabel")}
            secondary={t("settings.modals.backup.auto.changeHelper")}
          />
          <Switch
            edge="end"
            checked={values.changeEnabled}
            onChange={handleChangeToggle}
            disabled={disabled}
          />
        </Stack>
      </ListItem>
    </Fragment>
  );
}
