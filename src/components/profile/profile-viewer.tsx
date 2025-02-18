import { BaseDialog, Notice, SwitchLovely } from "@/components/base";
import { FileInput } from "@/components/profile/file-input";
import { createProfile, patchProfile } from "@/services/cmds";
import {
  Button,
  ButtonGroup,
  InputAdornment,
  InputLabel,
  styled,
  TextField,
} from "@mui/material";
import { getVersion } from "@tauri-apps/api/app";
import { useLockFn } from "ahooks";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

interface Props {
  onChange: () => void;
}

export interface ProfileViewerRef {
  create: (profileUid: string | null) => void;
  edit: (item: IProfileItem) => void;
}

// create or edit the profile
// remote / local / merge / script
export const ProfileViewer = forwardRef<ProfileViewerRef, Props>(
  (props, ref) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [openType, setOpenType] = useState<"new" | "edit">("new");
    const [loading, setLoading] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [onlyChain, setOnlyChain] = useState(false);

    // file input
    const fileDataRef = useRef<string | null>(null);

    const { control, watch, register, ...formIns } = useForm<IProfileItem>({
      defaultValues: {
        type: "remote",
        name: "",
        desc: "",
        url: "",
        option: {
          with_proxy: false,
          self_proxy: false,
        },
      },
    });

    useImperativeHandle(ref, () => ({
      create: (profileUid) => {
        if (profileUid) {
          // it means create a chain in this profile
          formIns.setValue("parent", profileUid);
          formIns.setValue("type", "merge");
          formIns.setValue("scope", "specific");
          setOnlyChain(true);
        }
        getVersion().then((version) => setAppVersion(version));
        setOpenType("new");
        setOpen(true);
      },
      edit: (item) => {
        getVersion().then((version) => setAppVersion(version));
        if (item) {
          Object.entries(item).forEach(([key, value]) => {
            formIns.setValue(key as any, value);
          });
          if (item.parent) {
            formIns.setValue("parent", item.parent);
            formIns.setValue("scope", "specific");
            setOnlyChain(true);
          }
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
        setLoading(true);
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
          } else {
            delete form.option?.update_interval;
          }
          if (form.option?.user_agent === "") {
            delete form.option.user_agent;
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
          setLoading(false);
          setTimeout(() => formIns.reset(), 500);
          fileDataRef.current = null;
          props.onChange();
        } catch (err: any) {
          Notice.error(err.message || err.toString());
          setLoading(false);
        }
      }),
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

    let selectType = ["remote", "local", "merge", "script"];
    if (onlyChain) {
      selectType = ["merge", "script"];
    }

    let defaultName = "remote file";
    switch (formType) {
      case "remote": {
        defaultName = "remote file";
        break;
      }
      case "local": {
        defaultName = "local file";
        break;
      }
      case "merge": {
        defaultName = "merge file";
        break;
      }
      case "script": {
        defaultName = "script file";
        break;
      }
    }

    return (
      <BaseDialog
        open={open}
        title={openType === "new" ? t("Create Profile") : t("Edit Profile")}
        okBtn={t("Save")}
        cancelBtn={t("Cancel")}
        onClose={handleClose}
        onCancel={handleClose}
        onOk={handleOk}
        loading={loading}>
        <form>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <ButtonGroup
                size="small"
                fullWidth
                disabled={openType === "edit"}
                aria-label="profile type button group">
                {selectType.map((type) => (
                  <Button
                    key={type}
                    variant={formType === type ? "contained" : "outlined"}
                    onClick={() => field.onChange(type)}>
                    {t(type)}
                  </Button>
                ))}
              </ButtonGroup>
            )}
          />
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <TextField
                {...text}
                {...field}
                label={t("Name")}
                placeholder={defaultName}
              />
            )}
          />
          <Controller
            name="desc"
            control={control}
            render={({ field }) => (
              <TextField {...text} {...field} label={t("Descriptions")} />
            )}
          />
          {isLocal && openType === "new" && (
            <FileInput
              onChange={(file, val) => {
                if (!formIns.getValues("name")) {
                  const name = file.name.substring(
                    0,
                    file.name.lastIndexOf("."),
                  );
                  formIns.setValue("name", name);
                }
                fileDataRef.current = val;
              }}
            />
          )}
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
                    placeholder={`clash-verge/v${appVersion}`}
                    label="User Agent"
                  />
                )}
              />
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
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">mins</InputAdornment>
                        ),
                      },
                    }}
                  />
                )}
              />
              <Controller
                name="option.with_proxy"
                control={control}
                render={({ field }) => (
                  <StyledDiv>
                    <InputLabel>{t("Use System Proxy")}</InputLabel>
                    <SwitchLovely
                      checked={field.value}
                      {...field}
                      color="primary"
                    />
                  </StyledDiv>
                )}
              />
              <Controller
                name="option.self_proxy"
                control={control}
                render={({ field }) => (
                  <StyledDiv>
                    <InputLabel>{t("Use Clash Proxy")}</InputLabel>
                    <SwitchLovely
                      checked={field.value}
                      {...field}
                      color="primary"
                    />
                  </StyledDiv>
                )}
              />
              <Controller
                name="option.danger_accept_invalid_certs"
                control={control}
                render={({ field }) => (
                  <StyledDiv>
                    <InputLabel>
                      {t("Accept Invalid Certs (Danger)")}
                    </InputLabel>
                    <SwitchLovely
                      checked={field.value}
                      {...field}
                      color="primary"
                    />
                  </StyledDiv>
                )}
              />
            </>
          )}
        </form>
      </BaseDialog>
    );
  },
);

const StyledDiv = styled("div")(() => ({
  margin: "8px 0 8px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
}));
