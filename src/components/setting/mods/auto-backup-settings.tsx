import {
  InputAdornment,
  ListItem,
  ListItemText,
  Stack,
  TextField,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { Fragment, useMemo, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { Switch } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/notice-service";

const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 168;

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
  const values = useMemo(() => {
    if (!pendingValues) {
      return derivedValues;
    }
    if (
      pendingValues.scheduleEnabled === derivedValues.scheduleEnabled &&
      pendingValues.intervalHours === derivedValues.intervalHours &&
      pendingValues.changeEnabled === derivedValues.changeEnabled
    ) {
      return derivedValues;
    }
    return pendingValues;
  }, [pendingValues, derivedValues]);
  const [intervalInputDraft, setIntervalInputDraft] = useState<string | null>(
    null,
  );

  const applyPatch = useLockFn(
    async (
      partial: Partial<AutoBackupState>,
      payload: Partial<IVergeConfig>,
    ) => {
      const nextValues = { ...values, ...partial };
      setPendingValues(nextValues);
      try {
        await patchVerge(payload);
      } catch (error) {
        showNotice.error(error);
        setPendingValues(null);
      }
    },
  );

  const disabled = !verge;

  const handleScheduleToggle = (
    _: ChangeEvent<HTMLInputElement>,
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

  const handleChangeToggle = (
    _: ChangeEvent<HTMLInputElement>,
    checked: boolean,
  ) => {
    applyPatch({ changeEnabled: checked }, { auto_backup_on_change: checked });
  };

  const handleIntervalInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setIntervalInputDraft(event.target.value);
  };

  const commitIntervalInput = () => {
    const rawValue = intervalInputDraft ?? values.intervalHours.toString();
    const trimmed = rawValue.trim();
    if (trimmed === "") {
      setIntervalInputDraft(null);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setIntervalInputDraft(null);
      return;
    }

    const clamped = Math.min(
      MAX_INTERVAL_HOURS,
      Math.max(MIN_INTERVAL_HOURS, Math.round(parsed)),
    );

    if (clamped === values.intervalHours) {
      setIntervalInputDraft(null);
      return;
    }

    applyPatch(
      { intervalHours: clamped },
      { auto_backup_interval_hours: clamped },
    );
    setIntervalInputDraft(null);
  };

  const scheduleDisabled = disabled || !values.scheduleEnabled;

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
          <TextField
            label={t("settings.modals.backup.auto.intervalLabel")}
            size="small"
            type="number"
            value={intervalInputDraft ?? values.intervalHours.toString()}
            disabled={scheduleDisabled}
            onChange={handleIntervalInputChange}
            onBlur={commitIntervalInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitIntervalInput();
              }
            }}
            sx={{ minWidth: 160 }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t("shared.units.hours")}
                  </InputAdornment>
                ),
              },
              htmlInput: {
                min: MIN_INTERVAL_HOURS,
                max: MAX_INTERVAL_HOURS,
                inputMode: "numeric",
              },
            }}
          />
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
