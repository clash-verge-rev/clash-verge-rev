import { BaseDialog, SwitchLovely } from "@/components/base";
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
import { useNotice } from "../base/notifice";

interface Props {
  onChange: () => void;
}

export interface ProfileViewerRef {
  create: (profileUid: string | null) => void;
  edit: (item: IProfileItem) => void;
}

const text = {
  fullWidth: true,
  size: "small",
  margin: "normal",
  variant: "outlined",
  autoComplete: "off",
  autoCorrect: "off",
} as const;

// create or edit the profile
// remote / local / merge / script
export const ProfileViewer = forwardRef<ProfileViewerRef, Props>(
  (props, ref) => {
    const { t } = useTranslation();
    const { notice } = useNotice();
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

    const formType = watch("type");
    const isRemote = formType === "remote";
    const isLocal = formType === "local";
    const selfProxy = watch("option.self_proxy");
    const withProxy = watch("option.with_proxy");

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

    useEffect(() => {
      if (selfProxy) formIns.setValue("option.with_proxy", false);
    }, [selfProxy]);

    useEffect(() => {
      if (withProxy) formIns.setValue("option.self_proxy", false);
    }, [withProxy]);

    useEffect(() => {
      formIns.setValue("name", defaultName);
    }, [formType, defaultName]);

    useEffect(() => {
      console.log(isRemote, appVersion);
      if (isRemote) return;
      formIns.setValue("option.user_agent", `clash-verge/${appVersion}`);
      console.log(formIns);
    }, [isRemote, appVersion]);

    useImperativeHandle(ref, () => ({
      create: async (profileUid) => {
        if (profileUid) {
          // it means create a chain in this profile
          formIns.setValue("parent", profileUid);
          formIns.setValue("type", "merge");
          formIns.setValue("name", "merge file");
          formIns.setValue("scope", "specific");
          setOnlyChain(true);
        } else {
          formIns.setValue("type", "remote");
          formIns.setValue("name", "remote file");
        }
        const version = await getVersion();
        setAppVersion(version);
        formIns.setValue("option.user_agent", `clash-verge/${version}`);
        setOpenType("new");
        setOpen(true);
      },
      edit: async (item) => {
        const version = await getVersion();
        setAppVersion(version);
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

    const handleOk = useLockFn(
      formIns.handleSubmit(async (form) => {
        setLoading(true);
        try {
          if (!form.type) throw new Error("`Type` should not be null");
          if (!form.name) {
            throw new Error("The name should not be empty");
          }
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
          // const name = form.name || `${form.type} file`;
          const item = { ...form };

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
          notice("error", err.message || err.toString());
          setLoading(false);
        }
      }),
    );

    const handleClose = () => {
      setOpen(false);
      fileDataRef.current = null;
      setTimeout(() => formIns.reset(), 500);
    };

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
              <TextField {...text} {...field} required label={t("Name")} />
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
                  <TextField {...text} {...field} label="User Agent" />
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
