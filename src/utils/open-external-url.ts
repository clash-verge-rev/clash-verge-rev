import { openUrl } from '@tauri-apps/plugin-opener'

export async function openExternalUrl(raw: string) {
  const url = new URL(raw.trim())

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are allowed')
  }

  await openUrl(url.toString())
}
