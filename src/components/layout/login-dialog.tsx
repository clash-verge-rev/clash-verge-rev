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
  email: string;
  password: string;
};

type PanelUrlCache = {
  url: string;
  expiresAt: number;
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
const SSPANEL_URL_CACHE_KEY = "sspanel-panel-url-cache";
const SSPANEL_PROFILE_KEY = "sspanel-profile";
const SSPANEL_URL_CACHE_TTL = 24 * 60 * 60 * 1000;
const URL_CHECK_TIMEOUT = 6000;
const SSPANEL_URL_API =
  "https://git.youxu.net/timorzzz/layerv2/raw/branch/main/urlapi.txt";

const defaultForm: LoginForm = {
  email: "",
  password: "",
};

const parseCandidateUrls = (raw: string) => {
  const cleaned = raw.trim();
  const decoded = atob(cleaned).trim();

  if (!decoded) {
    throw new Error("Decoded panel URL is empty");
  }

  const candidates = decoded
    .split(/[\n,\s]+/)
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (candidates.length === 0) {
    throw new Error("No panel URL candidates found");
  }

  return [...new Set(candidates)];
};

const getCachedPanelUrl = () => {
  const rawCache = localStorage.getItem(SSPANEL_URL_CACHE_KEY);

  if (!rawCache) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCache) as PanelUrlCache;
    if (!parsed.url || !parsed.expiresAt) {
      localStorage.removeItem(SSPANEL_URL_CACHE_KEY);
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(SSPANEL_URL_CACHE_KEY);
      return null;
    }

    return parsed.url;
  } catch {
    localStorage.removeItem(SSPANEL_URL_CACHE_KEY);
    return null;
  }
};

const cachePanelUrl = (url: string) => {
  const payload: PanelUrlCache = {
    url,
    expiresAt: Date.now() + SSPANEL_URL_CACHE_TTL,
  };
  localStorage.setItem(SSPANEL_URL_CACHE_KEY, JSON.stringify(payload));
};

const checkUrlAccessible = async (url: string) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT);

  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
};

const pickAvailablePanelUrl = async (candidates: string[]) => {
  for (const url of candidates) {
    const accessible = await checkUrlAccessible(url);
    if (accessible) {
      return url;
    }
  }

  throw new Error("No accessible panel URL found");
};

const resolvePanelUrlFromGit = async () => {
  const cached = getCachedPanelUrl();
  if (cached) {
    return cached;
  }

  const response = await fetch(SSPANEL_URL_API, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Fetch URL API failed: ${response.status}`);
  }

  const base64Text = await response.text();
  const candidates = parseCandidateUrls(base64Text);
  const panelUrl = await pickAvailablePanelUrl(candidates);
  cachePanelUrl(panelUrl);
  return panelUrl;
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
    return Boolean(form.email && form.password);
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
      const panelUrl = await resolvePanelUrlFromGit();
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
            label={t("layout.components.login.email")}
            value={form.email}
            onChange={handleChange("email")}
            size="small"
            autoFocus
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

          <Typography variant="caption" color="text.secondary">
            {t("layout.components.login.panelUrlHint")}
          </Typography>

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
