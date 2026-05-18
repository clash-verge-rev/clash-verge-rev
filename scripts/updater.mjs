import { getOctokit, context } from '@actions/github'
import fetch from 'node-fetch'

import { resolveUpdateLog, resolveUpdateLogDefault } from './updatelog.mjs'

/// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  return response.text()
}

function buildPlatformData() {
  return {
    win64: { signature: '', url: '' },
    linux: { signature: '', url: '' },
    darwin: { signature: '', url: '' },
    'darwin-aarch64': { signature: '', url: '' },
    'darwin-intel': { signature: '', url: '' },
    'darwin-x86_64': { signature: '', url: '' },
    'linux-x86_64': { signature: '', url: '' },
    'linux-x86': { signature: '', url: '' },
    'linux-i686': { signature: '', url: '' },
    'linux-aarch64': { signature: '', url: '' },
    'linux-armv7': { signature: '', url: '' },
    'windows-x86_64': { signature: '', url: '' },
    'windows-aarch64': { signature: '', url: '' },
    'windows-x86': { signature: '', url: '' },
    'windows-i686': { signature: '', url: '' },
  }
}

/// Map release assets to platform update data
async function processAssets(release, updateData) {
  const promises = release.assets.map(async (asset) => {
    const { name, browser_download_url } = asset

    // win64 url
    if (name.endsWith('x64-setup.exe')) {
      updateData.platforms.win64.url = browser_download_url
      updateData.platforms['windows-x86_64'].url = browser_download_url
    }
    // win64 signature
    if (name.endsWith('x64-setup.exe.sig')) {
      const sig = await getSignature(browser_download_url)
      updateData.platforms.win64.signature = sig
      updateData.platforms['windows-x86_64'].signature = sig
    }

    // win32 url
    if (name.endsWith('x86-setup.exe')) {
      updateData.platforms['windows-x86'].url = browser_download_url
      updateData.platforms['windows-i686'].url = browser_download_url
    }
    // win32 signature
    if (name.endsWith('x86-setup.exe.sig')) {
      const sig = await getSignature(browser_download_url)
      updateData.platforms['windows-x86'].signature = sig
      updateData.platforms['windows-i686'].signature = sig
    }

    // win arm url
    if (name.endsWith('arm64-setup.exe')) {
      updateData.platforms['windows-aarch64'].url = browser_download_url
    }
    // win arm signature
    if (name.endsWith('arm64-setup.exe.sig')) {
      const sig = await getSignature(browser_download_url)
      updateData.platforms['windows-aarch64'].signature = sig
    }

    // darwin url (intel)
    if (name.endsWith('.app.tar.gz') && !name.includes('aarch')) {
      updateData.platforms.darwin.url = browser_download_url
      updateData.platforms['darwin-intel'].url = browser_download_url
      updateData.platforms['darwin-x86_64'].url = browser_download_url
    }
    // darwin signature (intel)
    if (name.endsWith('.app.tar.gz.sig') && !name.includes('aarch')) {
      const sig = await getSignature(browser_download_url)
      updateData.platforms.darwin.signature = sig
      updateData.platforms['darwin-intel'].signature = sig
      updateData.platforms['darwin-x86_64'].signature = sig
    }

    // darwin url (aarch)
    if (name.endsWith('aarch64.app.tar.gz')) {
      updateData.platforms['darwin-aarch64'].url = browser_download_url
      // 使linux可以检查更新
      updateData.platforms.linux.url = browser_download_url
      updateData.platforms['linux-x86_64'].url = browser_download_url
      updateData.platforms['linux-x86'].url = browser_download_url
      updateData.platforms['linux-i686'].url = browser_download_url
      updateData.platforms['linux-aarch64'].url = browser_download_url
      updateData.platforms['linux-armv7'].url = browser_download_url
    }
    // darwin signature (aarch)
    if (name.endsWith('aarch64.app.tar.gz.sig')) {
      const sig = await getSignature(browser_download_url)
      updateData.platforms['darwin-aarch64'].signature = sig
      updateData.platforms.linux.signature = sig
      updateData.platforms['linux-x86_64'].signature = sig
      updateData.platforms['linux-x86'].signature = sig
      updateData.platforms['linux-i686'].signature = sig
      updateData.platforms['linux-aarch64'].signature = sig
      updateData.platforms['linux-armv7'].signature = sig
    }
  })

  await Promise.allSettled(promises)
}

/// Remove platforms without URLs, generate proxy data
function finalizeUpdateData(updateData) {
  Object.entries(updateData.platforms).forEach(([key, value]) => {
    if (!value.url) {
      console.log(`[Error]: failed to parse release for "${key}"`)
      delete updateData.platforms[key]
    }
  })

  const proxyData = JSON.parse(JSON.stringify(updateData))
  Object.entries(proxyData.platforms).forEach(([key, value]) => {
    if (value.url) {
      proxyData.platforms[key].url = 'https://update.hwdns.net/' + value.url
    } else {
      console.log(`[Error]: proxyData.platforms.${key} is null`)
    }
  })

  return proxyData
}

/// Upload update JSON files to a release tag (creates release if not found)
async function uploadToRelease(
  github,
  options,
  { tagName, jsonFile, proxyFile, releaseName, releaseBody, prerelease },
  updateData,
  proxyData,
) {
  let updateRelease

  try {
    const response = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: tagName,
    })
    updateRelease = response.data
    console.log(
      `Found existing ${tagName} release with ID: ${updateRelease.id}`,
    )
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release ${tagName} not found, creating...`)
      const createResponse = await github.rest.repos.createRelease({
        ...options,
        tag_name: tagName,
        name: releaseName,
        body: releaseBody,
        prerelease: !!prerelease,
      })
      updateRelease = createResponse.data
      console.log(`Created ${tagName} release with ID: ${updateRelease.id}`)
    } else {
      throw error
    }
  }

  // Delete existing assets with matching names
  for (const asset of updateRelease.assets) {
    if (asset.name === jsonFile || asset.name === proxyFile) {
      await github.rest.repos
        .deleteReleaseAsset({ ...options, asset_id: asset.id })
        .catch(console.error)
    }
  }

  // Upload new assets
  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: jsonFile,
    data: JSON.stringify(updateData, null, 2),
  })

  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: proxyFile,
    data: JSON.stringify(proxyData, null, 2),
  })

  console.log(`Successfully uploaded update files to ${tagName}`)
}

// ─── Channel: stable (default) ──────────────────────────���───────────────────

async function resolveStableChannel(github, options) {
  // Fetch tags to find the latest stable release (vX.Y.Z)
  let allTags = []
  let page = 1
  const perPage = 100

  while (true) {
    const { data: pageTags } = await github.rest.repos.listTags({
      ...options,
      per_page: perPage,
      page: page,
    })
    allTags = allTags.concat(pageTags)
    if (pageTags.length < perPage) break
    page++
  }

  console.log(`Retrieved ${allTags.length} tags in total`)

  const stableTag = allTags.find((t) => /^v\d+\.\d+\.\d+$/.test(t.name))

  console.log('Stable tag:', stableTag ? stableTag.name : 'None found')

  if (!stableTag) {
    console.log('No stable tag found, nothing to do')
    return
  }

  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: stableTag.name,
    })

    const updateData = {
      name: stableTag.name,
      notes: await resolveUpdateLog(stableTag.name).catch(() =>
        resolveUpdateLogDefault().catch(() => 'No changelog available'),
      ),
      pub_date: new Date().toISOString(),
      platforms: buildPlatformData(),
    }

    await processAssets(release, updateData)
    console.log(updateData)

    const proxyData = finalizeUpdateData(updateData)

    await uploadToRelease(
      github,
      options,
      {
        tagName: 'updater',
        jsonFile: 'update.json',
        proxyFile: 'update-proxy.json',
        releaseName: 'Auto-update Stable Channel',
        releaseBody:
          'This release contains the update information for stable channel.',
        prerelease: false,
      },
      updateData,
      proxyData,
    )
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release not found for tag: ${stableTag.name}, skipping...`)
    } else {
      console.error(
        `Failed to get release for tag: ${stableTag.name}`,
        error.message,
      )
    }
  }
}

// ─── Channel: autobuild ─────────────────────────────────────────────────────

function parseBaseVersion(version) {
  if (!version) return null
  const match = version.replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

function compareBase(a, b) {
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1
    if (a[i] < b[i]) return -1
  }
  return 0
}

function extractVersionFromAssets(assets) {
  for (const asset of assets) {
    const match = asset.name.match(
      /Clash[._]Verge[_-]([\d]+\.[\d]+\.[\d]+(?:[+][^\s_]+)?)/,
    )
    if (match) return match[1]
  }
  return null
}

async function resolveAutobuildChannel(github, options) {
  // 1. Get autobuild release
  let autobuildRelease = null
  try {
    const { data } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: 'autobuild',
    })
    autobuildRelease = data
  } catch (error) {
    if (error.status === 404) {
      console.log('No autobuild release found')
    } else {
      throw error
    }
  }

  // 2. Get latest stable release (vX.Y.Z tag)
  let stableRelease = null
  let stableTag = null
  const { data: tags } = await github.rest.repos.listTags({
    ...options,
    per_page: 20,
  })
  stableTag = tags.find((t) => /^v\d+\.\d+\.\d+$/.test(t.name))

  if (stableTag) {
    try {
      const { data } = await github.rest.repos.getReleaseByTag({
        ...options,
        tag: stableTag.name,
      })
      stableRelease = data
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }

  // 3. Compare base versions — stable wins only if strictly higher
  const autobuildVersion = autobuildRelease
    ? extractVersionFromAssets(autobuildRelease.assets)
    : null
  const stableVersion = stableTag?.name?.replace(/^v/, '') ?? null

  console.log(
    `Autobuild version: ${autobuildVersion} (base: ${parseBaseVersion(autobuildVersion)})`,
  )
  console.log(
    `Stable version: ${stableVersion} (base: ${parseBaseVersion(stableVersion)})`,
  )

  let useRelease, useVersion
  const cmp = compareBase(
    parseBaseVersion(stableVersion),
    parseBaseVersion(autobuildVersion),
  )

  if (cmp > 0 && stableRelease) {
    console.log('→ Using stable release (higher base version)')
    useRelease = stableRelease
    useVersion = stableVersion
  } else if (autobuildRelease && autobuildVersion) {
    console.log('→ Using autobuild release')
    useRelease = autobuildRelease
    useVersion = autobuildVersion
  } else if (stableRelease) {
    console.log('→ Falling back to stable release (no autobuild available)')
    useRelease = stableRelease
    useVersion = stableVersion
  } else {
    console.log('No releases found, nothing to do')
    return
  }

  // 4. Build update data
  const notes = await resolveUpdateLogDefault().catch(
    () =>
      'More new features are now supported. Check release page for details.',
  )

  const updateData = {
    version: useVersion,
    name: useVersion,
    notes,
    pub_date: new Date().toISOString(),
    platforms: buildPlatformData(),
  }

  await processAssets(useRelease, updateData)
  console.log(updateData)

  const proxyData = finalizeUpdateData(updateData)

  await uploadToRelease(
    github,
    options,
    {
      tagName: 'updater-autobuild',
      jsonFile: 'update.json',
      proxyFile: 'update-proxy.json',
      releaseName: 'Auto-update AutoBuild Channel',
      releaseBody:
        'This release contains the update information for the AutoBuild channel.',
      prerelease: true,
    },
    updateData,
    proxyData,
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)

  const channel = process.argv[2]

  if (channel === 'autobuild') {
    console.log('=== Resolving autobuild channel ===')
    await resolveAutobuildChannel(github, options)
  } else {
    console.log('=== Resolving stable channel ===')
    await resolveStableChannel(github, options)
  }
}

main().catch(console.error)
