import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  styled,
  TextField,
} from "@mui/material";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { BaseDialog, Switch } from "@/components/base";
import { useProfiles } from "@/hooks/use-profiles";
import { createProfile, patchProfile } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { version } from "@root/package.json";

import { FileInput } from "./file-input";

interface Props {
  onChange: (isActivating?: boolean) => void;
}

export interface ProfileViewerRef {
  create: () => void;
  edit: (item: IProfileItem) => void;
}

// create or edit the profile
// remote / local
type ProfileViewerProps = Props & { ref?: Ref<ProfileViewerRef> };

export function ProfileViewer({ onChange, ref }: ProfileViewerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openType, setOpenType] = useState<"new" | "edit">("new");
  const [loading, setLoading] = useState(false);
  const { profiles } = useProfiles();

  // file input
  const fileDataRef = useRef<string | null>(null);

  const { control, watch, setValue, reset, handleSubmit, getValues } =
    useForm<IProfileItem>({
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
    create: () => {
      setOpenType("new");
      setOpen(true);
    },
    edit: (item: IProfileItem) => {
      if (item) {
        Object.entries(item).forEach(([key, value]) => {
          setValue(key as any, value);
        });
      }
      setOpenType("edit");
      setOpen(true);
    },
  }));

  const selfProxy = watch("option.self_proxy");
  const withProxy = watch("option.with_proxy");

  useEffect(() => {
    if (selfProxy) setValue("option.with_proxy", false);
  }, [selfProxy, setValue]);

  useEffect(() => {
    if (withProxy) setValue("option.self_proxy", false);
  }, [setValue, withProxy]);

  const handleOk = useLockFn(
    handleSubmit(async (form) => {
      if (form.option?.timeout_seconds) {
        form.option.timeout_seconds = +form.option.timeout_seconds;
      }

      setLoading(true);
      try {
        // 基本验证
        if (!form.type) throw new Error("`Type` should not be null");
        if (form.type === "remote" && !form.url) {
          throw new Error("The URL should not be null");
        }

        // 处理表单数据
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
        const isRemote = form.type === "remote";
        const isUpdate = openType === "edit";

        // 判断是否是当前激活的配置
        const isActivating = isUpdate && form.uid === (profiles?.current ?? "");

        // 保存原始代理设置以便回退成功后恢复
        const originalOptions = {
          with_proxy: form.option?.with_proxy,
          self_proxy: form.option?.self_proxy,
        };

        // 执行创建或更新操作，本地配置不需要回退机制
        if (!isRemote) {
          if (openType === "new") {
            await createProfile(item, fileDataRef.current);
          } else {
            if (!form.uid) throw new Error("UID not found");
            await patchProfile(form.uid, item);
          }
        } else {
          // 远程配置使用回退机制
          try {
            // 尝试正常操作
            if (openType === "new") {
              await createProfile(item, fileDataRef.current);
            } else {
              if (!form.uid) throw new Error("UID not found");
              await patchProfile(form.uid, item);
            }
          } catch {
            // 首次创建/更新失败，尝试使用自身代理
            showNotice.info(
              "profiles.modals.profileForm.feedback.notifications.creationRetry",
            );

            // 使用自身代理的配置
            const retryItem = {
              ...item,
              option: {
                ...item.option,
                with_proxy: false,
                self_proxy: true,
              },
            };

            // 使用自身代理再次尝试
            if (openType === "new") {
              await createProfile(retryItem, fileDataRef.current);
            } else {
              if (!form.uid) throw new Error("UID not found");
              await patchProfile(form.uid, retryItem);

              // 编辑模式下恢复原始代理设置
              await patchProfile(form.uid, { option: originalOptions });
            }

            showNotice.success(
              "profiles.modals.profileForm.feedback.notifications.creationSuccess",
            );
          }
        }

        // 成功后的操作
        setOpen(false);
        setTimeout(() => reset(), 500);
        fileDataRef.current = null;

        // 优化：UI先关闭，异步通知父组件
        setTimeout(() => {
          onChange(isActivating);
        }, 0);
      } catch (err) {
        showNotice.error(err);
      } finally {
        setLoading(false);
      }
    }),
  );

  const handleClose = () => {
    try {
      setOpen(false);
      fileDataRef.current = null;
      setTimeout(() => reset(), 500);
    } catch (e) {
      console.warn("[ProfileViewer] handleClose error:", e);
    }
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
      title={
        openType === "new"
          ? t("profiles.modals.profileForm.title.create")
          : t("profiles.modals.profileForm.title.edit")
      }
      contentSx={{ width: 375, pb: 0, maxHeight: "80%" }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={handleClose}
      onCancel={handleClose}
      onOk={handleOk}
      loading={loading}
    >
      <Controller
        name="type"
        control={control}
        render={({ field }) => (
          <FormControl size="small" fullWidth sx={{ mt: 1, mb: 1 }}>
            <InputLabel>
              {t("profiles.modals.profileForm.fields.type")}
            </InputLabel>
            <Select
              {...field}
              autoFocus
              label={t("profiles.modals.profileForm.fields.type")}
            >
              <MenuItem value="remote">Remote</MenuItem>
              <MenuItem value="local">Local</MenuItem>
            </Select>
          </FormControl>
        )}
      />

      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <TextField {...text} {...field} label={t("shared.labels.name")} />
        )}
      />

      <Controller
        name="desc"
        control={control}
        render={({ field }) => (
          <TextField
            {...text}
            {...field}
            label={t("profiles.modals.profileForm.fields.description")}
          />
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
                label={t("profiles.modals.profileForm.fields.subscriptionUrl")}
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

          <Controller
            name="option.timeout_seconds"
            control={control}
            render={({ field }) => (
              <TextField
                {...text}
                {...field}
                type="number"
                placeholder="60"
                label={t("profiles.modals.profileForm.fields.httpTimeout")}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        {t("shared.units.seconds")}
                      </InputAdornment>
                    ),
                  },
                }}
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
              type="number"
              label={t("profiles.modals.profileForm.fields.updateInterval")}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("shared.units.minutes")}
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
        />
      )}

      {isLocal && openType === "new" && (
        <FileInput
          onChange={(file, val) => {
            setValue("name", getValues("name") || file.name);
            fileDataRef.current = val;
          }}
        />
      )}

      {isRemote && (
        <>
          <Controller
            name="option.with_proxy"
            control={control}
            render={({ field }) => (
              <StyledBox>
                <InputLabel>
                  {t("profiles.modals.profileForm.fields.useSystemProxy")}
                </InputLabel>
                <Switch checked={field.value} {...field} color="primary" />
              </StyledBox>
            )}
          />

          <Controller
            name="option.self_proxy"
            control={control}
            render={({ field }) => (
              <StyledBox>
                <InputLabel>
                  {t("profiles.modals.profileForm.fields.useClashProxy")}
                </InputLabel>
                <Switch checked={field.value} {...field} color="primary" />
              </StyledBox>
            )}
          />

          <Controller
            name="option.danger_accept_invalid_certs"
            control={control}
            render={({ field }) => (
              <StyledBox>
                <InputLabel>
                  {t("profiles.modals.profileForm.fields.acceptInvalidCerts")}
                </InputLabel>
                <Switch checked={field.value} {...field} color="primary" />
              </StyledBox>
            )}
          />

          <Controller
            name="option.allow_auto_update"
            control={control}
            render={({ field }) => (
              <StyledBox>
                <InputLabel>
                  {t("profiles.modals.profileForm.fields.allowAutoUpdate")}
                </InputLabel>
                <Switch checked={field.value} {...field} color="primary" />
              </StyledBox>
            )}
          />
        </>
      )}
    </BaseDialog>
  );
}

const StyledBox = styled(Box)(() => ({
  margin: "8px 0 8px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
}));
