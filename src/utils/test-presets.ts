import { nanoid } from 'nanoid'

import apple from '@/assets/image/test/apple.svg?raw'
import bilibili from '@/assets/image/test/bilibili.svg?raw'
import claude from '@/assets/image/test/claude.svg?raw'
import discord from '@/assets/image/test/discord.svg?raw'
import disneyplus from '@/assets/image/test/disneyplus.svg?raw'
import github from '@/assets/image/test/github.svg?raw'
import google from '@/assets/image/test/google.svg?raw'
import googlegemini from '@/assets/image/test/googlegemini.svg?raw'
import netflix from '@/assets/image/test/netflix.svg?raw'
import openai from '@/assets/image/test/openai.svg?raw'
import primevideo from '@/assets/image/test/primevideo.svg?raw'
import spotify from '@/assets/image/test/spotify.svg?raw'
import tiktok from '@/assets/image/test/tiktok.svg?raw'
import youtube from '@/assets/image/test/youtube.svg?raw'

export const TEST_PRESETS = [
  {
    uid: 'builtin-apple',
    name: 'Apple',
    url: 'https://www.apple.com',
    icon: apple,
  },
  {
    uid: 'builtin-github',
    name: 'GitHub',
    url: 'https://www.github.com',
    icon: github,
  },
  {
    uid: 'builtin-google',
    name: 'Google',
    url: 'https://www.google.com',
    icon: google,
  },
  {
    uid: 'builtin-youtube',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    icon: youtube,
  },
  {
    uid: 'builtin-chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    icon: openai,
  },
  {
    uid: 'builtin-claude',
    name: 'Claude',
    url: 'https://claude.ai',
    icon: claude,
  },
  {
    uid: 'builtin-gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    icon: googlegemini,
  },
  {
    uid: 'builtin-netflix',
    name: 'Netflix',
    url: 'https://www.netflix.com',
    icon: netflix,
  },
  {
    uid: 'builtin-disney',
    name: 'Disney+',
    url: 'https://www.disneyplus.com',
    icon: disneyplus,
  },
  {
    uid: 'builtin-primevideo',
    name: 'Prime Video',
    url: 'https://www.primevideo.com',
    icon: primevideo,
  },
  {
    uid: 'builtin-spotify',
    name: 'Spotify',
    url: 'https://open.spotify.com',
    icon: spotify,
  },
  {
    uid: 'builtin-tiktok',
    name: 'TikTok',
    url: 'https://www.tiktok.com',
    icon: tiktok,
  },
  {
    uid: 'builtin-discord',
    name: 'Discord',
    url: 'https://discord.com',
    icon: discord,
  },
  {
    uid: 'builtin-bilibili',
    name: 'Bilibili',
    url: 'https://www.bilibili.com',
    icon: bilibili,
  },
] satisfies IVergeTestItem[]

export const DEFAULT_TEST_LIST = TEST_PRESETS.slice(0, 4)

const normalizeTestUrl = (value: string | null | undefined) => {
  try {
    const url = new URL(value ?? '')
    url.hostname = url.hostname.replace(/^www\./, '')
    return url.href.replace(/\/$/, '')
  } catch {
    return null
  }
}

export const isTestPresetEnabled = (
  list: IVergeTestItem[],
  preset: IVergeTestItem,
) =>
  list.some(
    (item) => normalizeTestUrl(item.url) === normalizeTestUrl(preset.url),
  )

export const applyTestPresetSelection = (
  list: IVergeTestItem[],
  selected: string[],
) => [
  ...list.filter(
    (item) =>
      !TEST_PRESETS.some(
        (preset) =>
          !selected.includes(preset.uid) &&
          normalizeTestUrl(item.url) === normalizeTestUrl(preset.url),
      ),
  ),
  ...TEST_PRESETS.filter(
    (preset) =>
      selected.includes(preset.uid) && !isTestPresetEnabled(list, preset),
  ).map((preset) => ({ ...preset, uid: nanoid() })),
]
