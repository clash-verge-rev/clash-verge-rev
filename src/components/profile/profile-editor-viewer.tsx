import {
  BaseDialog,
  DraggableItem,
  Notice,
  ScrollableText,
  SwitchLovely,
} from "@/components/base";
import { LogViewer } from "@/components/profile/log-viewer";
import { LogMessage } from "@/components/profile/profile-more";
import { useProfiles } from "@/hooks/use-profiles";
import { useWindowSize } from "@/hooks/use-window-size";
import {
  enhanceProfiles,
  getChains,
  getTemplate,
  patchProfile,
  readProfileFile,
  reorderProfile,
  saveProfileFile,
  testMergeChain,
} from "@/services/cmds";
import monaco from "@/services/monaco";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
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
import {
  Add,
  CheckCircleOutline,
  ErrorOutline,
  ExpandMore,
  RadioButtonUnchecked,
  Reply,
  Terminal,
} from "@mui/icons-material";
import {
  Badge,
  BadgeProps,
  Button,
  ButtonGroup,
  Chip,
  Collapse,
  Divider,
  IconButton,
  InputAdornment,
  InputLabel,
  styled,
  TextField,
  Tooltip,
} from "@mui/material";
import { getVersion } from "@tauri-apps/api/app";
import { useLockFn, useMemoizedFn } from "ahooks";
import { isEqual } from "lodash-es";
import { IDisposable } from "monaco-editor";
import { nanoid } from "nanoid";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import ProfileMoreMini from "./profile-more-mini";
import { ProfileViewer, ProfileViewerRef } from "./profile-viewer";

interface Props {
  title?: string | ReactNode;
  profileItem: IProfileItem;
  chainLogs?: Record<string, LogMessage[]>;
  open: boolean;
  readOnly?: boolean;
  language: "yaml" | "javascript";
  type?: "clash" | "merge" | "script";
  onClose: () => void;
  onChange?: () => void;
}

export const ProfileEditorViewer = (props: Props) => {
  const {
    title,
    profileItem,
    chainLogs = {},
    open,
    readOnly,
    language,
    type,
    onClose,
    onChange,
  } = props;
  const { t } = useTranslation();
  const { size } = useWindowSize();
  const { current } = useProfiles();
  const profileUid = profileItem.uid;
  const isRunningProfile = current?.uid === profileUid;

  const [editProfile, setEditProfile] = useState<IProfileItem>(profileItem);
  const [originContent, setOriginContent] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const themeMode = useThemeMode();

  const isScriptMerge = editProfile.type === "script";
  const isEnhanced =
    editProfile.type === "script" || editProfile.type === "merge";

  // monaco
  const editorDomRef = useRef<any>();
  const instanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const codeLensRef = useRef<IDisposable | null>(null);
  let editChainCondition =
    useRef<monaco.editor.IContextKey<boolean | undefined>>();
  let saveChainCondition =
    useRef<monaco.editor.IContextKey<boolean | undefined>>();

  // chain
  const [chainChecked, setChainChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [expand, setExpand] = useState(isEnhanced ? true : false);
  const [chain, setChain] = useState<IProfileItem[]>([]);
  const enabledChainUids = chain.filter((i) => i.enable).map((i) => i.uid);
  const viewerRef = useRef<ProfileViewerRef>(null);
  const [reactivating, setReactivating] = useState(false);

  // script chain
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>(
    chainLogs[editProfile.uid] || [],
  );
  const hasError = isScriptMerge && !!logs?.find((item) => item.exception);

  // sortable
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );
  const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };
  const [draggingItem, setDraggingItem] = useState<IProfileItem | null>(null);

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

  // update profile
  const { control, watch, register, ...formIns } = useForm<IProfileItem>({
    defaultValues: profileItem,
  });
  const text = {
    fullWidth: true,
    size: "small",
    margin: "dense",
    variant: "outlined",
    autoComplete: "off",
    autoCorrect: "off",
  } as const;
  const profileName = watch("name");
  const formType = watch("type");
  const isRemote = formType === "remote";

  useEffect(() => {
    if (!open || instanceRef.current) return;
    getVersion().then((version) => {
      setAppVersion(version);
    });
    refreshChain();
    readProfileFile(profileUid).then(async (data) => {
      if (!originContent) {
        setOriginContent(data);
      }
      const dom = editorDomRef.current;
      if (!dom) return;
      if (instanceRef.current) instanceRef.current.dispose();
      const uri = monaco.Uri.parse(
        `${nanoid()}.${type}.${language}?uid=${profileUid}`,
      );
      const model = monaco.editor.createModel(data, language, uri);
      instanceRef.current = monaco.editor.create(dom, {
        model: model,
        language: language,
        tabSize: ["yaml", "javascript", "css"].includes(language) ? 2 : 4,
        theme: themeMode === "light" ? "vs" : "vs-dark",
        minimap: { enabled: dom.clientWidth >= 1000 },
        mouseWheelZoom: true,
        readOnly: readOnly,
        readOnlyMessage: { value: t("ReadOnlyMessage") },
        renderValidationDecorations: "on",
        quickSuggestions: {
          strings: true,
          comments: true,
          other: true,
        },
        automaticLayout: true,
        fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
          getSystem() === "windows" ? ", twemoji mozilla" : ""
        }`,
        fontLigatures: true,
        smoothScrolling: true,
      });

      // 用于判断当前编辑的是否为脚本文件
      editChainCondition.current = instanceRef.current?.createContextKey(
        "editChain",
        type && ["merge", "script"].includes(type),
      );

      // 用于判断当前编辑的脚本是否通过运行检测, 并且可以保存
      saveChainCondition.current = instanceRef.current?.createContextKey(
        "saveChain",
        false,
      );

      // F5 快速执行脚本运行检测
      instanceRef.current.addAction({
        id: "runChainCheck",
        label: "check run",
        keybindings: [monaco.KeyCode.F5],
        keybindingContext: "textInputFocus && editChain",
        run: async (ed) => {
          const chainUid = ed.getModel()?.uri.query.split("=").pop();
          if (chainUid) {
            await handleRunCheck(chainUid);
          }
        },
      });

      // Ctrl + s 保存当前编辑的配置内容
      instanceRef.current.addAction({
        id: "saveProfile",
        label: "save profile",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        keybindingContext: "textInputFocus",
        run: async (ed) => {
          const uri = ed.getModel()?.uri;
          const uid = uri?.query.split("=").pop();
          const val = instanceRef.current?.getValue();
          if (uid && val) {
            let checkSuccess = true;
            if (editChainCondition.current?.get()) {
              checkSuccess = saveChainCondition.current?.get() ?? false;
              if (!checkSuccess) {
                checkSuccess = await handleRunCheck(uid);
              }
            }
            if (checkSuccess) {
              if (isRunningProfile) {
                setReactivating(true);
              }
              await saveProfileFile(uid, val);
              setTimeout(() => {
                Notice.success(t("Save Content Successfully"), 1000);
                onChange?.();
                setReactivating(false);
              }, 1000);
            }
          }
        },
      });

      // 生成模板的命令方法
      const generateCommand = instanceRef.current?.addCommand(
        0,
        (_, scope: string, language: string) => {
          getTemplate(scope, language).then((templateContent) => {
            instanceRef.current?.setValue(templateContent);
            setChainChecked(false);
          });
        },
        "",
      );

      // 增强脚本模板生成
      codeLensRef.current = monaco.languages.registerCodeLensProvider(
        ["yaml", "javascript"],
        {
          provideCodeLenses(model, token) {
            const uriPath = model.uri.path;
            if (uriPath.includes("clash.yaml")) {
              return null;
            }
            const nextType = uriPath.includes("merge.yaml")
              ? "merge"
              : "script";
            const nextLanguage = uriPath.includes("merge.yaml")
              ? "yaml"
              : "javascript";
            return {
              lenses: [
                {
                  id: "Regenerate Template Content",
                  range: {
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 2,
                    endColumn: 1,
                  },
                  command: {
                    id: generateCommand!,
                    title: t("Regenerate Template Content"),
                    arguments: [nextType, nextLanguage],
                  },
                },
              ],
              dispose: () => {},
            };
          },
          resolveCodeLens(model, codeLens, token) {
            return codeLens;
          },
        },
      );

      instanceRef.current?.onDidChangeModel((e) => {
        const { newModelUrl } = e;
        const isChainMerge = !!newModelUrl?.path.includes("merge.yaml");
        const isChainScript = !!newModelUrl?.path.includes("script.js");
        if (isChainMerge || isChainScript) {
          editChainCondition.current?.set(true);
        } else {
          editChainCondition.current?.set(false);
        }
      });

      instanceRef.current?.onDidChangeModelContent(() => {
        setChainChecked(false);
        saveChainCondition.current?.set(false);
      });
    });

    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
      codeLensRef.current?.dispose();
      codeLensRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!editProfile) return;
    setLogs(chainLogs[editProfile.uid]);
  }, [editProfile, chainLogs]);

  instanceRef.current?.updateOptions({
    minimap: { enabled: size.width >= 1000 },
  });

  const refreshChain = async () => {
    let chain = await getChains(profileUid);
    setChain(chain);
  };

  const handleProfileSubmit = useLockFn(
    formIns.handleSubmit(async (form) => {
      const isSame = isEqual(form, profileItem);
      if (isSame) {
        return;
      }
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
        if (profileItem.enable) {
          form.enable = profileItem.enable;
        }
        const name = form.name || `${form.type} file`;
        const item = { ...form, name };

        if (!form.uid) throw new Error("UID not found");
        await patchProfile(form.uid, item);
        mutate("getProfiles");
      } catch (err: any) {
        Notice.error(err.message || err.toString());
      }
    }),
  );

  const handleRunCheck = async (currentProfileUid: string) => {
    try {
      const value = instanceRef.current?.getValue();
      if (value == undefined) return false;

      setChecking(true);
      const result = await testMergeChain(
        type === "clash" ? profileUid : null,
        currentProfileUid,
        value,
      );
      setChecking(false);
      setChainChecked(true);
      const currentLogs = result.logs[currentProfileUid] || [];
      setLogs(currentLogs);
      if (currentLogs) {
        if (currentLogs[0]?.exception) {
          Notice.error(t("Script Run Check Failed"));
          saveChainCondition.current?.set(false);
          return false;
        }
      }
      Notice.success(t("Script Run Check Successful"));
      saveChainCondition.current?.set(true);
      return true;
    } catch (error: any) {
      saveChainCondition.current?.set(false);
      Notice.error(error);
      return false;
    } finally {
      setChecking(false);
    }
  };

  const handleChainClick = async (item: IProfileItem) => {
    let content = await readProfileFile(item.uid);
    const backToOriginalProfile = editProfile.uid === item.uid;
    if (backToOriginalProfile) {
      // 两次点击，表示编辑初始的配置内容
      setEditProfile(profileItem);
      content = await readProfileFile(profileUid);
    } else {
      setEditProfile(item);
    }
    setOriginContent(content);
    setChainChecked(false);
    let oldModel = instanceRef.current?.getModel();
    let newModel = null;
    if (backToOriginalProfile) {
      const id = nanoid();
      let uri_str = `${id}.${type}.${language}?uid=${profileUid}`;
      let uri = monaco.Uri.parse(uri_str);
      newModel = monaco.editor.createModel(content, "yaml", uri);
    } else if (item.type === "script") {
      newModel = monaco.editor.createModel(
        content,
        "javascript",
        monaco.Uri.parse(`${nanoid()}.script.js?uid=${item.uid}`),
      );
    } else {
      const id = nanoid();
      let uri_str = `${id}.${type}.${language}`;
      if (item.uid !== profileUid) {
        uri_str = `${id}.merge.yaml?uid=${item.uid}`;
      }
      let uri = monaco.Uri.parse(uri_str);
      newModel = monaco.editor.createModel(content, "yaml", uri);
    }
    instanceRef.current?.setModel(newModel);
    instanceRef.current?.focus();
    oldModel?.dispose();
  };

  const handleChainDeleteCallBack = async (item: IProfileItem) => {
    if (item.uid === editProfile.uid) {
      setEditProfile(profileItem);
      const content = await readProfileFile(profileUid);
      setOriginContent(content);
      setChainChecked(false);
      let oldModel = instanceRef.current?.getModel();
      const id = nanoid();
      let uri_str = `${id}.${type}.${language}?uid=${profileUid}`;
      let uri = monaco.Uri.parse(uri_str);
      const newModel = monaco.editor.createModel(content, "yaml", uri);
      instanceRef.current?.setModel(newModel);
      instanceRef.current?.focus();
      oldModel?.dispose();
    }
    mutate("getRuntimeLogs");
    await refreshChain();
  };

  const onSave = useLockFn(async () => {
    if (isScriptMerge && hasError) {
      Notice.error(t("Script Run Check Failed"));
      return;
    }
    const value = instanceRef.current?.getValue();
    if (value == undefined) return;
    try {
      await handleProfileSubmit();
      if (originContent !== value) {
        await saveProfileFile(editProfile.uid, value);
        onChange?.();
      } else {
        Notice.info(t("Profile Content No Changes"));
      }
      setOriginContent(value);
      setChainChecked(false);
      // setExpand(type !== "clash");
      // if (profileUid === editProfile.uid) {
      //   onClose();
      // }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <>
      <BaseDialog
        open={open}
        title={title ?? t("Edit File")}
        full
        cancelBtn={t("Back")}
        okBtn={t("Save")}
        hideOkBtn={readOnly}
        okDisabled={isEnhanced && (!chainChecked || hasError)}
        onClose={() => {
          setLogs(chainLogs[editProfile.uid] || []);
          setChainChecked(false);
          setEditProfile(profileItem);
          setExpand(type !== "clash");
          onClose();
        }}
        onCancel={() => {
          setLogs(chainLogs[editProfile.uid] || []);
          setChainChecked(false);
          setEditProfile(profileItem);
          setExpand(type !== "clash");
          onClose();
        }}
        onOk={onSave}
        contentStyle={{ userSelect: "text" }}>
        <div className="bg-comment flex h-full overflow-hidden dark:bg-[#1e1f27]">
          <div className="no-scrollbar w-1/4 min-w-[260px] overflow-auto">
            <div
              className="bg-primary-alpha flex cursor-pointer items-center justify-between p-2"
              onClick={() => setExpand(!expand)}>
              <ScrollableText>
                <span className="text-md font-bold">{profileName}</span>
              </ScrollableText>
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

                  <div className="overflow-auto">
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
                              key={item.uid}
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
                            onToggleEnableCallback={async (enabled) => {
                              mutate("getRuntimeLogs");
                              await refreshChain();
                            }}
                            onClick={async () => {
                              await handleChainClick(draggingItem);
                            }}
                            onInfoChangeCallback={refreshChain}
                            onDeleteCallback={async () => {
                              await handleChainDeleteCallBack(draggingItem);
                            }}
                          />
                        )}
                      </DragOverlay>
                    </DndContext>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="h-full w-full overflow-hidden" ref={editorDomRef} />

          <div className="flex w-14 flex-col items-center justify-end !space-y-2 px-1 pb-4">
            <Tooltip title={t("Restore Changes")} placement="left">
              <IconButton
                aria-label="rollback"
                size="medium"
                onClick={() => {
                  if (originContent) {
                    instanceRef.current?.setValue(originContent);
                  }
                }}>
                <Reply fontSize="medium" />
              </IconButton>
            </Tooltip>
            {(isEnhanced || editProfile.uid !== profileUid) && (
              <>
                {isScriptMerge && (
                  <Tooltip title={t("Console")} placement="left">
                    <IconButton
                      aria-label="terminal"
                      size="medium"
                      color="primary"
                      onClick={() => setLogOpen(true)}>
                      {hasError ? (
                        <Badge color="error" variant="dot">
                          <Terminal color="error" fontSize="medium" />
                        </Badge>
                      ) : (
                        <StyledBadge
                          badgeContent={logs?.length}
                          color="primary">
                          <Terminal color="primary" fontSize="medium" />
                        </StyledBadge>
                      )}
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t("Run Check")} placement="left">
                  <IconButton
                    loading={checking}
                    aria-label="test"
                    color={
                      chainChecked
                        ? hasError
                          ? "error"
                          : "success"
                        : "inherit"
                    }
                    size="medium"
                    onClick={async () => await handleRunCheck(editProfile.uid)}>
                    {chainChecked ? (
                      hasError ? (
                        <ErrorOutline fontSize="medium" />
                      ) : (
                        <CheckCircleOutline fontSize="medium" />
                      )
                    ) : (
                      <RadioButtonUnchecked fontSize="medium" />
                    )}
                  </IconButton>
                </Tooltip>
              </>
            )}
          </div>
        </div>
        {isScriptMerge && (
          <LogViewer
            open={logOpen}
            logInfo={logs || []}
            onClose={() => setLogOpen(false)}
          />
        )}
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

const StyledBadge = styled(Badge)<BadgeProps>(({ theme }) => ({
  "& .MuiBadge-badge": {
    right: 0,
    top: 3,
    border: `2px solid ${theme.palette.background.paper}`,
    padding: "0 4px",
  },
}));
