import { context, getOctokit } from '@actions/github'

import { resolveUpdateLog, resolveUpdateLogDefault } from './updatelog.mjs'

// Add stable update JSON filenames
const UPDATE_TAG_NAME = 'updater'
const UPDATE_JSON_FILE = 'update.json'
const UPDATE_JSON_PROXY = 'update-proxy.json'
// Add alpha update JSON filenames
const ALPHA_TAG_NAME = 'updater-alpha'
const ALPHA_UPDATE_JSON_FILE = 'update.json'
const ALPHA_UPDATE_JSON_PROXY = 'update-proxy.json'

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)

  // Fetch all tags using pagination
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

    // Break if we received fewer tags than requested (last page)
    if (pageTags.length < perPage) {
      break
    }

    page++
  }

  const tags = allTags
  console.log(`Retrieved ${tags.length} tags in total`)

  // More flexible tag detection with regex patterns
  const stableTagRegex = /^v\d+\.\d+\.\d+$/ // Matches vX.Y.Z format
  // const preReleaseRegex = /^v\d+\.\d+\.\d+-(alpha|beta|rc|pre)/i; // Matches vX.Y.Z-alpha/beta/rc format
  const preReleaseRegex = /^(alpha|beta|rc|pre)$/i // Matches exact alpha/beta/rc/pre tags

  // Get the latest stable tag and pre-release tag
  const stableTag = tags.find((t) => stableTagRegex.test(t.name))
  const preReleaseTag = tags.find((t) => preReleaseRegex.test(t.name))

  console.log('All tags:', tags.map((t) => t.name).join(', '))
  console.log('Stable tag:', stableTag ? stableTag.name : 'None found')
  console.log(
    'Pre-release tag:',
    preReleaseTag ? preReleaseTag.name : 'None found',
  )
  console.log()

  // Process stable release
  if (stableTag) {
    await processRelease(github, options, stableTag, false)
  }

  // Process pre-release if found
  if (preReleaseTag) {
    await processRelease(github, options, preReleaseTag, true)
  }
}

// Process a release (stable or alpha) and generate update files
async function processRelease(github, options, tag, isAlpha) {
  if (!tag) return

  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: tag.name,
    })

    const updateData = {
      name: tag.name,
      notes: await resolveUpdateLog(tag.name).catch(() =>
        resolveUpdateLogDefault().catch(() => 'No changelog available'),
      ),
      pub_date: new Date().toISOString(),
      platforms: {
        // platform format:
        //    standard: "{os}-{arch}-{installer}",
        //    fallback: "{os}-{arch}"
        'darwin-x86_64': { signature: '', url: '' },
        'darwin-x86_64-app': { signature: '', url: '' },
        'darwin-aarch64': { signature: '', url: '' },
        'darwin-aarch64-app': { signature: '', url: '' },

        'linux-x86': { signature: '', url: '' },
        'linux-x86-deb': { signature: '', url: '' },
        'linux-x86-rpm': { signature: '', url: '' },
        'linux-x86_64': { signature: '', url: '' },
        'linux-x86_64-deb': { signature: '', url: '' },
        'linux-x86_64-rpm': { signature: '', url: '' },
        'linux-i686': { signature: '', url: '' },
        'linux-i686-deb': { signature: '', url: '' },
        'linux-i686-rpm': { signature: '', url: '' },
        'linux-aarch64': { signature: '', url: '' },
        'linux-aarch64-deb': { signature: '', url: '' },
        'linux-aarch64-rpm': { signature: '', url: '' },
        'linux-armv7': { signature: '', url: '' },
        'linux-armv7-deb': { signature: '', url: '' },
        'linux-armv7-rpm': { signature: '', url: '' },

        'windows-x86': { signature: '', url: '' },
        'windows-x86-nsis': { signature: '', url: '' },
        'windows-x86_64': { signature: '', url: '' },
        'windows-x86_64-nsis': { signature: '', url: '' },
        'windows-aarch64': { signature: '', url: '' },
        'windows-aarch64-nsis': { signature: '', url: '' },
        'windows-i686': { signature: '', url: '' },
        'windows-i686-nsis': { signature: '', url: '' },
      },
    }

    const promises = release.assets.map(async (asset) => {
      const { name, browser_download_url } = asset

      // Process all the platform URL and signature data
      // win64 url
      if (name.endsWith('x64-setup.exe')) {
        updateData.platforms['windows-x86_64'].url = browser_download_url
        updateData.platforms['windows-x86_64-nsis'].url = browser_download_url
      }
      // win64 signature
      if (name.endsWith('x64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-x86_64'].signature = sig
        updateData.platforms['windows-x86_64-nsis'].signature = sig
      }
      // win32 url
      if (name.endsWith('x86-setup.exe')) {
        updateData.platforms['windows-x86'].url = browser_download_url
        updateData.platforms['windows-x86-nsis'].url = browser_download_url
        updateData.platforms['windows-i686-nsis'].url = browser_download_url
      }
      // win32 signature
      if (name.endsWith('x86-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-x86'].signature = sig
        updateData.platforms['windows-x86-nsis'].signature = sig
        updateData.platforms['windows-i686-nsis'].signature = sig
      }
      // win arm url
      if (name.endsWith('arm64-setup.exe')) {
        updateData.platforms['windows-aarch64'].url = browser_download_url
        updateData.platforms['windows-aarch64-nsis'].url = browser_download_url
      }
      // win arm signature
      if (name.endsWith('arm64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-aarch64'].signature = sig
        updateData.platforms['windows-aarch64-nsis'].signature = sig
      }

      // darwin url (intel)
      if (name.endsWith('.app.tar.gz') && !name.includes('aarch')) {
        updateData.platforms['darwin-x86_64'].url = browser_download_url
        updateData.platforms['darwin-x86_64-app'].url = browser_download_url
      }
      // darwin signature (intel)
      if (name.endsWith('.app.tar.gz.sig') && !name.includes('aarch')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['darwin-x86_64'].signature = sig
        updateData.platforms['darwin-x86_64-app'].signature = sig
      }
      // darwin url (aarch)
      if (name.endsWith('aarch64.app.tar.gz')) {
        updateData.platforms['darwin-aarch64'].url = browser_download_url
        updateData.platforms['darwin-aarch64-app'].url = browser_download_url
      }
      // darwin signature (aarch)
      if (name.endsWith('aarch64.app.tar.gz.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['darwin-aarch64'].signature = sig
        updateData.platforms['darwin-aarch64-app'].signature = sig
      }

      // Linux x86
      if (name.endsWith('i386.deb')) {
        updateData.platforms['linux-x86'].url = browser_download_url
        updateData.platforms['linux-x86-deb'].url = browser_download_url
        updateData.platforms['linux-i686'].url = browser_download_url
        updateData.platforms['linux-i686-deb'].url = browser_download_url
      }
      if (name.endsWith('i386.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86'].signature = sig
        updateData.platforms['linux-x86-deb'].signature = sig
        updateData.platforms['linux-i686'].signature = sig
        updateData.platforms['linux-i686-deb'].signature = browser_download_url
      }
      if (name.endsWith('i386.rpm')) {
        updateData.platforms['linux-x86-rpm'].url = browser_download_url
        updateData.platforms['linux-i686-rpm'].url = browser_download_url
      }
      if (name.endsWith('i386.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86-rpm'].signature = sig
        updateData.platforms['linux-i686-rpm'].signature = sig
      }

      // Linux x86_64
      if (name.endsWith('amd64.deb')) {
        updateData.platforms['linux-x86_64'].url = browser_download_url
        updateData.platforms['linux-x86_64-deb'].url = browser_download_url
      }
      if (name.endsWith('amd64.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86_64'].signature = sig
        updateData.platforms['linux-x86_64-deb'].signature = sig
      }
      if (name.endsWith('x86_64.rpm')) {
        updateData.platforms['linux-x86_64-rpm'].url = browser_download_url
      }
      if (name.endsWith('x86_64.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86_64-rpm'].signature = sig
      }

      // Linux aarch64
      if (name.endsWith('arm64.deb')) {
        updateData.platforms['linux-aarch64'].url = browser_download_url
        updateData.platforms['linux-aarch64-deb'].url = browser_download_url
      }
      if (name.endsWith('arm64.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-aarch64'].signature = sig
        updateData.platforms['linux-aarch64-deb'].signature = sig
      }
      if (name.endsWith('aarch64.rpm')) {
        updateData.platforms['linux-aarch64-rpm'].url = browser_download_url
      }
      if (name.endsWith('aarch64.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-aarch64-rpm'].signature = sig
      }

      // Linux armv7
      if (name.endsWith('armhf.deb')) {
        updateData.platforms['linux-armv7'].url = browser_download_url
        updateData.platforms['linux-armv7-deb'].url = browser_download_url
      }
      if (name.endsWith('armhf.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-armv7'].signature = sig
        updateData.platforms['linux-armv7-deb'].signature = sig
      }
      if (name.endsWith('armhfp.rpm')) {
        updateData.platforms['linux-armv7-rpm'].url = browser_download_url
      }
      if (name.endsWith('armhfp.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-armv7-rpm'].signature = sig
      }
    })

    await Promise.allSettled(promises)
    console.log(updateData)

    // maybe should test the signature as well
    // delete the null field
    Object.entries(updateData.platforms).forEach(([key, value]) => {
      if (!value.url) {
        console.log(`[Error]: failed to parse release for "${key}"`)
        delete updateData.platforms[key]
      }
    })

    // Generate a proxy update file for accelerated GitHub resources
    const updateDataNew = JSON.parse(JSON.stringify(updateData))

    Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
      if (value.url) {
        updateDataNew.platforms[key].url =
          `https://update.hwdns.net/${value.url}`
      } else {
        console.log(`[Error]: updateDataNew.platforms.${key} is null`)
      }
    })

    // Get the appropriate updater release based on isAlpha flag
    const releaseTag = isAlpha ? ALPHA_TAG_NAME : UPDATE_TAG_NAME
    console.log(
      `Processing ${isAlpha ? 'alpha' : 'stable'} release:`,
      releaseTag,
    )

    try {
      let updateRelease

      try {
        // Try to get the existing release
        const response = await github.rest.repos.getReleaseByTag({
          ...options,
          tag: releaseTag,
        })
        updateRelease = response.data
        console.log(
          `Found existing ${releaseTag} release with ID: ${updateRelease.id}`,
        )
      } catch (error) {
        // If release doesn't exist, create it
        if (error.status === 404) {
          console.log(
            `Release with tag ${releaseTag} not found, creating new release...`,
          )
          const createResponse = await github.rest.repos.createRelease({
            ...options,
            tag_name: releaseTag,
            name: isAlpha
              ? 'Auto-update Alpha Channel'
              : 'Auto-update Stable Channel',
            body: `This release contains the update information for ${isAlpha ? 'alpha' : 'stable'} channel.`,
            prerelease: isAlpha,
          })
          updateRelease = createResponse.data
          console.log(
            `Created new ${releaseTag} release with ID: ${updateRelease.id}`,
          )
        } else {
          // If it's another error, throw it
          throw error
        }
      }

      // File names based on release type
      const jsonFile = isAlpha ? ALPHA_UPDATE_JSON_FILE : UPDATE_JSON_FILE
      const proxyFile = isAlpha ? ALPHA_UPDATE_JSON_PROXY : UPDATE_JSON_PROXY

      // Delete existing assets with these names
      for (const asset of updateRelease.assets) {
        if (asset.name === jsonFile) {
          await github.rest.repos.deleteReleaseAsset({
            ...options,
            asset_id: asset.id,
          })
        }

        if (asset.name === proxyFile) {
          await github.rest.repos
            .deleteReleaseAsset({ ...options, asset_id: asset.id })
            .catch(console.error) // do not break the pipeline
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
        data: JSON.stringify(updateDataNew, null, 2),
      })

      console.log(
        `Successfully uploaded ${isAlpha ? 'alpha' : 'stable'} update files to ${releaseTag}`,
      )
    } catch (error) {
      console.error(
        `Failed to process ${isAlpha ? 'alpha' : 'stable'} release:`,
        error.message,
      )
    }
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release not found for tag: ${tag.name}, skipping...`)
    } else {
      console.error(`Failed to get release for tag: ${tag.name}`, error.message)
    }
  }
}

// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })

  return response.text()
}

resolveUpdater().catch(console.error)
