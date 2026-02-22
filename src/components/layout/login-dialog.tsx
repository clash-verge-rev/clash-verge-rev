import { LoadingButton } from "@mui/lab";
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type ChangeEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getProfiles, importProfile, updateProfile } from "@/services/cmds";

type LoginForm = {
  panelUrl: string;
  email: string;
  password: string;
};

type SspanelLoginResponse = {
  ret: 0 | 1;
  msg?: string;
};

type SspanelUserInfoResponse = {
  ret: 0 | 1;
  msg?: string;
  info?: {
    ssrSubToken?: string;
    subUrl?: string;
    baseUrl?: string;
    mergeSub?: boolean;
    user?: Record<string, unknown>;
  };
};

const SSPANEL_AUTH_KEY = "sspanel-auth";
const SSPANEL_PROFILE_KEY = "sspanel-profile";

const defaultForm: LoginForm = {
  panelUrl: "",
  email: "",
  password: "",
};

const normalizePanelUrl = (url: string) => {
  const normalized = url.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("Panel URL must start with http:// or https://");
  }
  return normalized;
};

const sspanelLogin = async (panelUrl: string, form: LoginForm) => {
  const response = await fetch(`${panelUrl}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: form.email,
      passwd: form.password,
      code: "",
      remember_me: true,
    }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`SSPanel login failed with HTTP status ${response.status}`);
  }

  return (await response.json()) as SspanelLoginResponse;
};

const fetchSspanelUserInfo = async (panelUrl: string) => {
  const response = await fetch(`${panelUrl}/getuserinfo`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      `SSPanel getuserinfo failed with HTTP status ${response.status}`,
    );
  }

  return (await response.json()) as SspanelUserInfoResponse;
};

const composeClashSubscriptionUrl = (info: SspanelUserInfoResponse["info"]) => {
  if (!info?.subUrl || !info?.ssrSubToken) {
    return "";
  }

  const root = (info.baseUrl || info.subUrl).replace(/\/$/, "");
  const tokenPath = `${root}/${info.ssrSubToken}`;
  const separator = tokenPath.includes("?") ? "&" : "?";
  return `${tokenPath}${separator}clash=2`;
};

const upsertClashSubscriptionProfile = async (subscriptionUrl: string) => {
  if (!subscriptionUrl) {
    throw new Error("Missing SSPanel clash subscription URL");
  }

  const profiles = await getProfiles();
  const existing = profiles.items?.find(
    (item) => item.type === "remote" && item.url === subscriptionUrl,
  );

  if (existing?.uid) {
    await updateProfile(existing.uid, { with_proxy: true });
    return;
  }

  await importProfile(subscriptionUrl, { with_proxy: true });
};

export const LoginDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => {
    const loggedIn = localStorage.getItem(SSPANEL_AUTH_KEY);
    return !loggedIn;
  });
  const [form, setForm] = useState<LoginForm>(defaultForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(form.panelUrl && form.email && form.password);
  }, [form]);

  const handleChange =
    (field: keyof LoginForm) => (event: ChangeEvent<HTMLInputElement>) => {
      setError("");
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleLogin = async () => {
    if (!canSubmit) {
      setError(t("layout.components.login.error.required"));
      return;
    }

    setLoading(true);

    try {
      const panelUrl = normalizePanelUrl(form.panelUrl);
      const loginResult = await sspanelLogin(panelUrl, form);

      if (loginResult.ret !== 1) {
        throw new Error(
          loginResult.msg || t("layout.components.login.error.loginFailed"),
        );
      }

      const userInfoResult = await fetchSspanelUserInfo(panelUrl);
      if (userInfoResult.ret !== 1 || !userInfoResult.info) {
        throw new Error(
          userInfoResult.msg ||
            t("layout.components.login.error.userInfoFailed"),
        );
      }

      const subscriptionUrl = composeClashSubscriptionUrl(userInfoResult.info);
      await upsertClashSubscriptionProfile(subscriptionUrl);

      localStorage.setItem(
        SSPANEL_PROFILE_KEY,
        JSON.stringify({
          panelUrl,
          userInfo: userInfoResult.info,
          subscriptionUrl,
          fetchedAt: Date.now(),
        }),
      );

      localStorage.setItem(
        SSPANEL_AUTH_KEY,
        JSON.stringify({
          panelUrl,
          email: form.email,
          loginAt: Date.now(),
        }),
      );
      setOpen(false);
    } catch (e) {
      console.error("[LoginDialog] Login flow failed:", e);
      setError(
        e instanceof Error
          ? e.message
          : t("layout.components.login.error.unknown"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle>{t("layout.components.login.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t("layout.components.login.description")}
          </Typography>

          <TextField
            label={t("layout.components.login.panelUrl")}
            value={form.panelUrl}
            onChange={handleChange("panelUrl")}
            size="small"
            autoFocus
            fullWidth
            placeholder="https://your-sspanel-domain"
          />

          <TextField
            label={t("layout.components.login.email")}
            value={form.email}
            onChange={handleChange("email")}
            size="small"
            fullWidth
          />

          <TextField
            type="password"
            label={t("layout.components.login.password")}
            value={form.password}
            onChange={handleChange("password")}
            size="small"
            fullWidth
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleLogin();
              }
            }}
          />

          {error && <Alert severity="error">{error}</Alert>}

          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <LoadingButton
              variant="contained"
              loading={loading}
              onClick={handleLogin}
              disabled={!canSubmit}
            >
              {t("layout.components.login.submit")}
            </LoadingButton>
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
