import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  styled,
  TextField,
} from "@mui/material";
import { createProfile, patchProfile } from "@/services/cmds";
import { BaseDialog, Notice } from "@/components/base";
import { version } from "@root/package.json";
import { FileInput } from "./file-input";

interface Props {
  onChange: () => void;
}

export interface ProfileViewerRef {
  create: () => void;
  edit: (item: IProfileItem) => void;
}

// create or edit the profile
// remote / local / merge / script
export const ProfileViewer = forwardRef<ProfileViewerRef, Props>(
  (props, ref) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [openType, setOpenType] = useState<"new" | "edit">("new");

    // file input
    const fileDataRef = useRef<string | null>(null);

    const { control, watch, register, ...formIns } = useForm<IProfileItem>({
      defaultValues: {
        type: "remote",
        name: "Remote File",
        desc: "",
        url: "",
        option: {
          // user_agent: "",
          with_proxy: false,
          self_proxy: false,
        },
      },
    });

    useImperativeHandle(ref, () => ({
      create: () => {
        setOpenType("new");
        setOpen(true);
      },
      edit: (item) => {
        if (item) {
          Object.entries(item).forEach(([key, value]) => {
            formIns.setValue(key as any, value);
          });
        }
        setOpenType("edit");
        setOpen(true);
      },
    }));

    const selfProxy = watch("option.self_proxy");
    const withProxy = watch("option.with_proxy");

    useEffect(() => {
      if (selfProxy) formIns.setValue("option.with_proxy", false);
    }, [selfProxy]);

    useEffect(() => {
      if (withProxy) formIns.setValue("option.self_proxy", false);
    }, [withProxy]);

    const handleOk = useLockFn(
      formIns.handleSubmit(async (form) => {
        try {
          if (!form.type) throw new Error("`Type` should not be null");
          if (form.type === "remote" && !form.url) {
            throw new Error("The URL should not be null");
          }
          if (form.type !== "remote" && form.type !== "local") {
            delete form.option;
          }
          if (form.option?.update_interval) {
            form.option.update_interval = +form.option.update_interval;
          }
          const name = form.name || `${form.type} file`;
          const item = { ...form, name };

          // 创建
          if (openType === "new") {
            await createProfile(item, fileDataRef.current);
          }
          // 编辑
          else {
            if (!form.uid) throw new Error("UID not found");
            await patchProfile(form.uid, item);
          }
          setOpen(false);
          setTimeout(() => formIns.reset(), 500);
          fileDataRef.current = null;
          props.onChange();
        } catch (err: any) {
          Notice.error(err.message || err.toString());
        }
      })
    );

    const handleClose = () => {
      setOpen(false);
      fileDataRef.current = null;
      setTimeout(() => formIns.reset(), 500);
    };

    const text = {
      fullWidth: true,
      size: "small",
      margin: "normal",
      variant: "outlined",
      autoComplete: "off",
      autoCorrect: "off",
    } as const;

    const formType = watch("type");
    const isRemote = formType === "remote";
    const isLocal = formType === "local";

    return (
      <BaseDialog
        open={open}
        title={openType === "new" ? t("Create Profile") : t("Edit Profile")}
        contentSx={{ width: 375, pb: 0, maxHeight: "80%" }}
        okBtn={t("Save")}
        cancelBtn={t("Cancel")}
        onClose={handleClose}
        onCancel={handleClose}
        onOk={handleOk}
      >
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <FormControl size="small" fullWidth sx={{ mt: 1, mb: 1 }}>
              <InputLabel>{t("Type")}</InputLabel>
              <Select {...field} autoFocus label={t("Type")}>
                <MenuItem value="remote">Remote</MenuItem>
                <MenuItem value="local">Local</MenuItem>
                <MenuItem value="script">Script</MenuItem>
                <MenuItem value="merge">Merge</MenuItem>
              </Select>
            </FormControl>
          )}
        />

        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <TextField {...text} {...field} label={t("Name")} />
          )}
        />

        <Controller
          name="desc"
          control={control}
          render={({ field }) => (
            <TextField {...text} {...field} label={t("Descriptions")} />
          )}
        />

        {isRemote && (
          <>
            <Controller
              name="url"
              control={control}
              render={({ field }) => (
                <TextField
                  {...text}
                  {...field}
                  multiline
                  label={t("Subscription URL")}
                />
              )}
            />

            <Controller
              name="option.user_agent"
              control={control}
              render={({ field }) => (
                <TextField
                  {...text}
                  {...field}
                  placeholder={`clash-verge/v${version}`}
                  label="User Agent"
                />
              )}
            />
          </>
        )}

        {(isRemote || isLocal) && (
          <Controller
            name="option.update_interval"
            control={control}
            render={({ field }) => (
              <TextField
                {...text}
                {...field}
                onChange={(e) => {
                  e.target.value = e.target.value
                    ?.replace(/\D/, "")
                    .slice(0, 10);
                  field.onChange(e);
                }}
                label={t("Update Interval")}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">mins</InputAdornment>
                  ),
                }}
              />
            )}
          />
        )}

        {isLocal && openType === "new" && (
          <FileInput onChange={(val) => (fileDataRef.current = val)} />
        )}

        {isRemote && (
          <>
            <Controller
              name="option.with_proxy"
              control={control}
              render={({ field }) => (
                <StyledBox>
                  <InputLabel>{t("Use System Proxy")}</InputLabel>
                  <Switch checked={field.value} {...field} color="primary" />
                </StyledBox>
              )}
            />

            <Controller
              name="option.self_proxy"
              control={control}
              render={({ field }) => (
                <StyledBox>
                  <InputLabel>{t("Use Clash Proxy")}</InputLabel>
                  <Switch checked={field.value} {...field} color="primary" />
                </StyledBox>
              )}
            />
          </>
        )}
      </BaseDialog>
    );
  }
);

const StyledBox = styled(Box)(() => ({
  margin: "8px 0 8px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
}));
