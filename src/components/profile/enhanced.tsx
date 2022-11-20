import useSWR from "swr";
import { useLockFn } from "ahooks";
import { Grid } from "@mui/material";
import {
  getProfiles,
  deleteProfile,
  patchProfilesConfig,
  getRuntimeLogs,
} from "@/services/cmds";
import { Notice } from "@/components/base";
import { ProfileMore } from "./profile-more";

interface Props {
  items: IProfileItem[];
  chain: string[];
}

export const EnhancedMode = (props: Props) => {
  const { items, chain } = props;

  const { mutate: mutateProfiles } = useSWR("getProfiles", getProfiles);
  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs
  );

  const onEnhanceEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;

    const newChain = [...chain, uid];
    await patchProfilesConfig({ chain: newChain });
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  const onEnhanceDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid);
    await patchProfilesConfig({ chain: newChain });
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
    await patchProfilesConfig({ chain: newChain });
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  const onMoveEnd = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;

    const newChain = chain.filter((i) => i !== uid).concat([uid]);
    await patchProfilesConfig({ chain: newChain });
    mutateProfiles((conf = {}) => ({ ...conf, chain: newChain }), true);
    mutateLogs();
  });

  return (
    <Grid container spacing={{ xs: 2, lg: 3 }}>
      {items.map((item) => (
        <Grid item xs={12} sm={6} md={4} lg={3} key={item.file}>
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
  );
};
