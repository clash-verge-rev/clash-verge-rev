import { BaseDialog, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { TextField } from "@mui/material";
import { nanoid } from "nanoid";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
  const { setValue, register, handleSubmit, reset } = useForm<IVergeTestItem>({
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
          setValue(key as any, value);
        });
      }
      setOpenType("edit");
      setOpen(true);
    },
  }));

  const onSubmit = async (data: IVergeTestItem) => {
    setLoading(true);
    try {
      if (!data.name) throw new Error("`Name` should not be null");
      if (!data.url) throw new Error("`Url` should not be null");
      let newList;
      let uid;

      if (openType === "new") {
        uid = nanoid();
        const item = { ...data, uid };
        newList = [...testList, item];
        await patchVerge({ test_list: newList });
        props.onChange(uid);
      } else {
        if (!data.uid) throw new Error("UID not found");
        uid = data.uid;

        await patchTestList(uid, data);
        props.onChange(uid, data);
      }
      setOpen(false);
      setLoading(false);
      setTimeout(() => reset(), 500);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => reset(), 500);
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
      contentStyle={{ width: 375 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={handleClose}
      onCancel={handleClose}
      onOk={handleSubmit(onSubmit)}
      loading={loading}>
      <form>
        <TextField {...text} {...register("name")} label={t("Name")} />
        <TextField {...text} {...register("icon")} label={t("Icon")} />
        <TextField {...text} {...register("url")} label={t("Test URL")} />
      </form>
    </BaseDialog>
  );
});
