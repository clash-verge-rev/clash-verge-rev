import useSWR, { useSWRConfig } from "swr";
import { useLockFn } from "ahooks";
import { useEffect, useMemo, useState } from "react";
import { useSetRecoilState } from "recoil";
import { Box, Button, Grid, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  getProfiles,
  patchProfile,
  selectProfile,
  importProfile,
} from "../services/cmds";
import { getProxies, updateProxy } from "../services/api";
import { atomCurrentProfile } from "../services/states";
import Notice from "../components/base/base-notice";
import BasePage from "../components/base/base-page";
import ProfileNew from "../components/profile/profile-new";
import ProfileItem from "../components/profile/profile-item";
import EnhancedMode from "../components/profile/enhanced";

const ProfilePage = () => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const setCurrentProfile = useSetRecoilState(atomCurrentProfile);

  const { data: profiles = {} } = useSWR("getProfiles", getProfiles);

  // distinguish type
  const { regularItems, enhanceItems } = useMemo(() => {
    const items = profiles.items || [];
    const chain = profiles.chain || [];

    const type1 = ["local", "remote"];
    const type2 = ["merge", "script"];

    const regularItems = items.filter((i) => type1.includes(i.type!));
    const restItems = items.filter((i) => type2.includes(i.type!));

    const restMap = Object.fromEntries(restItems.map((i) => [i.uid, i]));

    const enhanceItems = chain
      .map((i) => restMap[i]!)
      .concat(restItems.filter((i) => !chain.includes(i.uid)));

    return { regularItems, enhanceItems };
  }, [profiles]);

  // sync selected proxy
  useEffect(() => {
    if (profiles.current == null) return;

    const current = profiles.current;
    const profile = regularItems.find((p) => p.uid === current);

    setCurrentProfile(current);

    if (!profile) return;

    setTimeout(async () => {
      const proxiesData = await getProxies();
      mutate("getProxies", proxiesData);

      // init selected array
      const { selected = [] } = profile;
      const selectedMap = Object.fromEntries(
        selected.map((each) => [each.name!, each.now!])
      );

      let hasChange = false;

      const { global, groups } = proxiesData;
      [global, ...groups].forEach((group) => {
        const { name, now } = group;

        if (!now || selectedMap[name] === now) return;
        if (selectedMap[name] == null) {
          selectedMap[name] = now!;
        } else {
          hasChange = true;
          updateProxy(name, selectedMap[name]);
        }
      });

      // update profile selected list
      profile.selected = Object.entries(selectedMap).map(([name, now]) => ({
        name,
        now,
      }));

      patchProfile(current!, { selected: profile.selected });
      // update proxies cache
      if (hasChange) mutate("getProxies", getProxies());
    }, 100);
  }, [profiles, regularItems]);

  const onImport = async () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);

    try {
      await importProfile(url);
      Notice.success("Successfully import profile.");

      getProfiles().then((newProfiles) => {
        mutate("getProfiles", newProfiles);

        if (!newProfiles.current && newProfiles.items?.length) {
          const current = newProfiles.items[0].uid;
          selectProfile(current);
          mutate("getProfiles", { ...newProfiles, current }, true);
        }
      });
    } catch {
      Notice.error("Failed to import profile.");
    } finally {
      setDisabled(false);
    }
  };

  const onSelect = useLockFn(async (uid: string, force: boolean) => {
    if (!force && uid === profiles.current) return;

    try {
      await selectProfile(uid);
      setCurrentProfile(uid);
      mutate("getProfiles", { ...profiles, current: uid }, true);
      if (force) Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  return (
    <BasePage title={t("Profiles")}>
      <Box sx={{ display: "flex", mb: 2.5 }}>
        <TextField
          id="clas_verge_profile_url"
          name="profile_url"
          label={t("Profile URL")}
          size="small"
          fullWidth
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          sx={{ mr: 1 }}
        />
        <Button
          disabled={!url || disabled}
          variant="contained"
          onClick={onImport}
          sx={{ mr: 1 }}
        >
          {t("Import")}
        </Button>
        <Button variant="contained" onClick={() => setDialogOpen(true)}>
          {t("New")}
        </Button>
      </Box>

      <Grid container spacing={2}>
        {regularItems.map((item) => (
          <Grid item xs={12} sm={6} key={item.file}>
            <ProfileItem
              selected={profiles.current === item.uid}
              itemData={item}
              onSelect={(f) => onSelect(item.uid, f)}
            />
          </Grid>
        ))}
      </Grid>

      {enhanceItems.length > 0 && (
        <EnhancedMode items={enhanceItems} chain={profiles.chain || []} />
      )}

      <ProfileNew open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </BasePage>
  );
};

export default ProfilePage;
