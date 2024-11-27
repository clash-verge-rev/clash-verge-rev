import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { TextField } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, Notice } from "@/components/base";
import { nanoid } from "nanoid";

interface Props {
  onChange: (uid: string, patch?: Partial<IVergeTestItem>) => void;
}

export interface TestViewerRef {
  create: () => void;
  edit: (item: IVergeTestItem) => void;
}

// create or edit the test item
export const TestViewer = forwardRef<TestViewerRef, Props>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openType, setOpenType] = useState<"new" | "edit">("new");
  const [loading, setLoading] = useState(false);
  const { verge, patchVerge } = useVerge();
  const testList = verge?.test_list ?? [];
  const { control, watch, register, ...formIns } = useForm<IVergeTestItem>({
    defaultValues: {
      name: "",
      icon: "",
      url: "",
    },
  });

  const patchTestList = async (uid: string, patch: Partial<IVergeTestItem>) => {
    const newList = testList.map((x) => {
      if (x.uid === uid) {
        return { ...x, ...patch };
      }
      return x;
    });
    await patchVerge({ test_list: newList });
  };

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

  const handleOk = useLockFn(
    formIns.handleSubmit(async (form) => {
      setLoading(true);
      try {
        if (!form.name) throw new Error("`Name` should not be null");
        if (!form.url) throw new Error("`Url` should not be null");

        let newList;
        let uid;

        if (form.icon && form.icon.startsWith("<svg")) {
          // 移除 icon 中的注释
          if (form.icon) {
            form.icon = form.icon.replace(/<!--[\s\S]*?-->/g, "");
          }
          const doc = new DOMParser().parseFromString(
            form.icon,
            "image/svg+xml",
          );
          if (doc.querySelector("parsererror")) {
            throw new Error("`Icon`svg format error");
          }
        }

        if (openType === "new") {
          uid = nanoid();
          const item = { ...form, uid };
          newList = [...testList, item];
          await patchVerge({ test_list: newList });
          props.onChange(uid);
        } else {
          if (!form.uid) throw new Error("UID not found");
          uid = form.uid;

          await patchTestList(uid, form);
          props.onChange(uid, form);
        }
        setOpen(false);
        setLoading(false);
        setTimeout(() => formIns.reset(), 500);
      } catch (err: any) {
        Notice.error(err.message || err.toString());
        setLoading(false);
      }
    }),
  );

  const handleClose = () => {
    setOpen(false);
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

  return (
    <BaseDialog
      open={open}
      title={openType === "new" ? t("Create Test") : t("Edit Test")}
      contentSx={{ width: 375, pb: 0, maxHeight: "80%" }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={handleClose}
      onCancel={handleClose}
      onOk={handleOk}
      loading={loading}
    >
      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <TextField {...text} {...field} label={t("Name")} />
        )}
      />
      <Controller
        name="icon"
        control={control}
        render={({ field }) => (
          <TextField
            {...text}
            {...field}
            multiline
            maxRows={5}
            label={t("Icon")}
          />
        )}
      />
      <Controller
        name="url"
        control={control}
        render={({ field }) => (
          <TextField
            {...text}
            {...field}
            multiline
            maxRows={3}
            label={t("Test URL")}
          />
        )}
      />
    </BaseDialog>
  );
});
