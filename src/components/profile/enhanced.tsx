import useSWR from "swr";
import { useLockFn } from "ahooks";
import { Box, Grid, IconButton, Stack } from "@mui/material";
import { RestartAltRounded } from "@mui/icons-material";
import {
  getProfiles,
  deleteProfile,
  enhanceProfiles,
  changeProfileChain,
  getRuntimeLogs,
} from "@/services/cmds";
import ProfileMore from "./profile-more";
import Notice from "../base/base-notice";

interface Props {
  items: CmdType.ProfileItem[];
  chain: string[];
}

const EnhancedMode = (props: Props) => {
  const { items, chain } = props;

  const { mutate: mutateProfiles } = useSWR("getProfiles", getProfiles);
  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs
  );

  // handler
  const onEnhance = useLockFn(async () => {
    try {
      await enhanceProfiles();
      mutateLogs();
      Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  const onEnhanceEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;

    const newChain = [...chain, uid];
    await changeProfileChain(newChain);
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  const onEnhanceDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid);
    await changeProfileChain(newChain);
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  const onEnhanceDelete = useLockFn(async (uid: string) => {
    try {
      await onEnhanceDisable(uid);
      await deleteProfile(uid);
      mutateProfiles();
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onMoveTop = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = [uid].concat(chain.filter((i) => i !== uid));
    await changeProfileChain(newChain);
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  const onMoveEnd = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid).concat([uid]);
    await changeProfileChain(newChain);
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  return (
    <Box sx={{ mt: 2 }}>
      <Stack
        spacing={1}
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        sx={{ mb: 0.5 }}
      >
        <IconButton
          size="small"
          color="inherit"
          title="refresh enhanced profiles"
          onClick={onEnhance}
        >
          <RestartAltRounded />
        </IconButton>
      </Stack>

      <Grid container spacing={2}>
        {items.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileMore
              selected={!!chain.includes(item.uid)}
              itemData={item}
              enableNum={chain.length}
              logInfo={chainLogs[item.uid]}
              onEnable={() => onEnhanceEnable(item.uid)}
              onDisable={() => onEnhanceDisable(item.uid)}
              onDelete={() => onEnhanceDelete(item.uid)}
              onMoveTop={() => onMoveTop(item.uid)}
              onMoveEnd={() => onMoveEnd(item.uid)}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default EnhancedMode;
