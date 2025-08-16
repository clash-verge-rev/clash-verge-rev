import {
  BaseDialog,
  DraggableItem,
  Marquee,
  SwitchLovely,
} from "@/components/base";
import { LogMessage } from "@/components/profile/profile-more";
import { useProfiles } from "@/hooks/use-profiles";
import {
  enhanceProfiles,
  getChains,
  patchProfile,
  reorderProfile,
} from "@/services/cmds";
import { sleep } from "@/utils";
import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DropAnimation,
  MouseSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import { Add, ExpandMore } from "@mui/icons-material";
import {
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  InputAdornment,
  InputLabel,
  styled,
  TextField,
} from "@mui/material";
import { getVersion } from "@tauri-apps/api/app";
import { useLockFn, useMemoizedFn } from "ahooks";
import { isEqual } from "lodash-es";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import { useNotice } from "../base/notifice";
import { ConfirmViewer } from "./confirm-viewer";
import { ProfileEditor, ProfileEditorHandle } from "./profile-editor";
import ProfileMoreMini from "./profile-more-mini";
import { ProfileViewer, ProfileViewerRef } from "./profile-viewer";

interface Props {
  title?: string | ReactNode;
  profileItem: IProfileItem;
  chainLogs?: Record<string, LogMessage[]>;
  open: boolean;
  type?: "clash" | "merge" | "script";
  onClose: () => void;
  onChange?: () => void;
}

const text = {
  fullWidth: true,
  size: "small",
  margin: "dense",
  variant: "outlined",
  autoComplete: "off",
  autoCorrect: "off",
} as const;

export const ProfileEditorViewer = (props: Props) => {
  const {
    title,
    profileItem,
    chainLogs = {},
    open,
    type,
    onClose,
    onChange,
  } = props;
  const { t } = useTranslation();
  const { current } = useProfiles();
  const { notice } = useNotice();
  const profileUid = profileItem.uid;
  const isRunningProfile = current?.uid === profileUid;
  const [editProfile, setEditProfile] = useState<IProfileItem>(profileItem);
  const [appVersion, setAppVersion] = useState("");
  const [curContentSaved, setCurContentSaved] = useState(true);
  const profileEditorRef = useRef<ProfileEditorHandle>(null);
  // confirm saved when edit other profile
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const resolveRef = useRef<any>(null);
  // chain
  const isEditChain =
    editProfile.type === "merge" || editProfile.type === "script";
  const [expand, setExpand] = useState(isEditChain);
  const [chain, setChain] = useState<IProfileItem[]>([]);
  const enabledChainUids = chain.filter((i) => i.enable).map((i) => i.uid);
  const viewerRef = useRef<ProfileViewerRef>(null);
  const [reactivating, setReactivating] = useState(false);
  // sortable
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 2 } }),
  );
  const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };
  const [draggingItem, setDraggingItem] = useState<IProfileItem | null>(null);
  // update profile
  const { control, watch, register, ...formIns } = useForm<IProfileItem>({
    defaultValues: profileItem,
  });

  const profileName = watch("name");
  const formType = watch("type");
  const isRemote = formType === "remote";
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getVersion().then((version) => {
      setAppVersion(version);
      if (isRemote) {
        formIns.setValue("option.user_agent", `clash-verge/${version}`);
      }
    });
    refreshChain();
  }, [open]);

  const showConfirm = () => {
    setSaveConfirmOpen(true);
    return new Promise((resolve: (status: boolean) => void) => {
      resolveRef.current = resolve;
    });
  };

  const handleConfirm = () => {
    setSaveConfirmOpen(false);
    setCurContentSaved(true);
    resolveRef.current(true);
  };

  const handleCancel = () => {
    setSaveConfirmOpen(false);
    profileEditorRef.current?.reset();
    setCurContentSaved(true);
    resolveRef.current(false);
  };

  const handleChainDragEnd = useMemoizedFn(async (event: DragEndEvent) => {
    setDraggingItem(null);
    const { active, over } = event;
    if (over) {
      const activeId = active.id.toString();
      const overId = over.id.toString();
      if (activeId !== overId) {
        const activeIndex = chain.findIndex((item) => item.uid === activeId);
        const overIndex = chain.findIndex((item) => item.uid === overId);
        const newChainList = arrayMove(chain, activeIndex, overIndex);
        const newEnabledChainUids = newChainList
          .filter((i) => i.enable)
          .map((item) => item.uid);
        const needToEnhance =
          !isEqual(enabledChainUids, newEnabledChainUids) && isRunningProfile;
        setChain(newChainList);
        await reorderProfile(activeId, overId);
        if (needToEnhance) {
          setReactivating(true);
          await enhanceProfiles();
          setReactivating(false);
          mutate("getRuntimeLogs");
        }
        await refreshChain();
      }
    }
  });

  const refreshChain = async () => {
    let chain = await getChains(profileUid);
    setChain(chain);
  };

  const handleProfileSubmit = useLockFn(
    formIns.handleSubmit(async (form) => {
      const isSame = isEqual(form, profileItem);
      if (isSame) {
        notice("info", t("Profile Config No Change"));
        return;
      }
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
        if (profileItem.enable) {
          form.enable = profileItem.enable;
        }
        const item = { ...form };

        if (!form.uid) throw new Error("UID not found");
        await patchProfile(form.uid, item);
        notice("success", t("Profile Config Updated"));
        mutate("getProfiles");
      } catch (err: any) {
        notice("error", err.message || err.toString());
      }
    }),
  );

  const handleChainClick = async (item: IProfileItem) => {
    if (!curContentSaved) {
      const status = await showConfirm();
      if (status) {
        const saveStatus = !!(await profileEditorRef.current?.save());
        if (!saveStatus) {
          return;
        }
      }
      // 延迟 1s 后，执行后续操作
      await sleep(1000);
    }
    const backToOriginalProfile = editProfile.uid === item.uid;
    if (backToOriginalProfile) {
      // 两次点击，表示编辑主配置文件内容
      setEditProfile(profileItem);
    } else {
      setEditProfile(item);
    }
  };

  const handleChainDeleteCallBack = async (item: IProfileItem) => {
    if (item.uid === editProfile.uid) {
      setEditProfile(profileItem);
    }
    mutate("getRuntimeLogs");
    await refreshChain();
  };

  const onSave = useLockFn(async () => {
    try {
      setSaving(true);
      if (!curContentSaved) {
        const saveStatus = !!(await profileEditorRef.current?.save());
        if (!saveStatus) {
          notice("error", t("Save Content Failed"));
          return;
        }
        // 延迟 1s 后，执行订阅配置项更新操作
        await sleep(1000);
      }
      await handleProfileSubmit();
    } catch (err: any) {
      notice("error", err.message || err.toString());
    } finally {
      setSaving(false);
    }
  });

  return (
    <>
      <BaseDialog
        open={open}
        title={title ?? t("Edit File")}
        full
        cancelBtn={t("Cancel")}
        okBtn={t("Save")}
        onClose={() => {
          setEditProfile(profileItem);
          setExpand(type !== "clash");
          onClose();
        }}
        onCancel={() => {
          setEditProfile(profileItem);
          setExpand(type !== "clash");
          onClose();
        }}
        loading={saving}
        onOk={onSave}
        contentStyle={{ userSelect: "text" }}>
        <div className="bg-comment flex h-full overflow-hidden dark:bg-[#1e1f27]">
          <div className="no-scrollbar w-1/4 min-w-[260px] overflow-auto">
            <div className="bg-comment sticky top-0 z-10">
              <div
                className="bg-primary-alpha flex cursor-pointer items-center justify-between p-2"
                onClick={() => setExpand(!expand)}>
                <Marquee pauseOnHover>
                  <span className="text-md font-bold">{profileName}</span>
                </Marquee>
                <Chip
                  label={t(formType || "local")}
                  size="small"
                  color="primary"
                  className="mr-1 ml-2"
                />
                <IconButton size="small">
                  <ExpandMore
                    fontSize="inherit"
                    color="primary"
                    style={{
                      transform: expand ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.3s ease-in-out",
                    }}
                  />
                </IconButton>
              </div>
            </div>

            <Collapse
              in={expand}
              timeout={"auto"}
              unmountOnExit
              className="mt-2 px-2">
              <form>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...text}
                      {...field}
                      required
                      label={t("Name")}
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
                                <InputAdornment position="end">
                                  mins
                                </InputAdornment>
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
            </Collapse>

            {type === "clash" && (
              <>
                <Divider
                  variant="fullWidth"
                  className="my-2 text-sm text-gray-400"
                  flexItem>
                  {t("Enhance Scripts")}
                </Divider>
                <div className="px-2">
                  <Button
                    size="small"
                    variant="contained"
                    fullWidth
                    startIcon={<Add />}
                    onClick={() => viewerRef.current?.create(profileUid)}>
                    {t("Add")}
                  </Button>

                  <ProfileViewer
                    ref={viewerRef}
                    onChange={async () => await refreshChain()}
                  />

                  <div className="overflow-auto pl-1">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragOver={(event) => {
                        const { over } = event;
                        if (over) {
                          const item = chain.find(
                            (i) => i.uid === event.active.id,
                          )!;
                          setDraggingItem(item);
                        }
                      }}
                      onDragEnd={(e) => handleChainDragEnd(e)}
                      onDragCancel={() => setDraggingItem(null)}>
                      <SortableContext items={chain.map((i) => i.uid)}>
                        {chain.map((item, index) => (
                          <DraggableItem key={item.uid} id={item.uid}>
                            <ProfileMoreMini
                              item={item}
                              isDragging={item.uid === draggingItem?.uid}
                              reactivating={reactivating && item.enable}
                              selected={item.uid === editProfile.uid}
                              logs={chainLogs[item.uid]}
                              onToggleEnableCallback={async (enabled) => {
                                mutate("getRuntimeLogs");
                                await refreshChain();
                              }}
                              onClick={async () => {
                                await handleChainClick(item);
                              }}
                              onInfoChangeCallback={refreshChain}
                              onDeleteCallback={async () => {
                                await handleChainDeleteCallBack(item);
                              }}
                            />
                          </DraggableItem>
                        ))}
                      </SortableContext>
                      <DragOverlay dropAnimation={dropAnimationConfig}>
                        {draggingItem && (
                          <ProfileMoreMini
                            key={draggingItem.uid}
                            item={draggingItem}
                            isDragging={true}
                            reactivating={reactivating && draggingItem.enable}
                            selected={draggingItem.uid === editProfile.uid}
                            logs={chainLogs[draggingItem.uid]}
                          />
                        )}
                      </DragOverlay>
                    </DndContext>
                  </div>
                </div>
              </>
            )}
          </div>

          <ProfileEditor
            ref={profileEditorRef}
            parentUid={editProfile.parent}
            chainLogs={chainLogs}
            profileItem={editProfile}
            onChange={() => setCurContentSaved(false)}
            onReset={() => setCurContentSaved(true)}
            onSave={() => {
              setCurContentSaved(true);
              if (editProfile.enable || editProfile.uid === profileUid) {
                onChange?.();
              }
            }}
          />

          <ConfirmViewer
            title={t("Save Content", { keymap: "" })}
            open={saveConfirmOpen}
            message={t("Ask Save Content Now")}
            onConfirm={() => handleConfirm()}
            onClose={() => handleCancel()}
          />
        </div>
      </BaseDialog>
    </>
  );
};

const StyledDiv = styled("div")(() => ({
  margin: "8px 0 8px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
}));
