import process from "node:process";

import { getOctokit, context } from "@actions/github";
import fetch from "node-fetch";

import { resolveUpdateLog, resolveUpdateLogDefault } from "./updatelog.mjs";

// Add stable update JSON filenames
const UPDATE_TAG_NAME = "updater";
const UPDATE_JSON_FILE = "update.json";
const UPDATE_JSON_PROXY = "update-proxy.json";
// Add alpha update JSON filenames
const ALPHA_TAG_NAME = "updater-alpha";
const ALPHA_UPDATE_JSON_FILE = "update.json";
const ALPHA_UPDATE_JSON_PROXY = "update-proxy.json";
// Add autobuild update JSON filenames
const AUTOBUILD_SOURCE_TAG_NAME = "autobuild";
const AUTOBUILD_TAG_NAME = "updater-autobuild";
const AUTOBUILD_UPDATE_JSON_FILE = "update.json";
const AUTOBUILD_UPDATE_JSON_PROXY = "update-proxy.json";

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);

  // Fetch all tags using pagination
  let allTags = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data: pageTags } = await github.rest.repos.listTags({
      ...options,
      per_page: perPage,
      page: page,
    });

    allTags = allTags.concat(pageTags);

    // Break if we received fewer tags than requested (last page)
    if (pageTags.length < perPage) {
      break;
    }

    page++;
  }

  const tags = allTags;
  console.log(`Retrieved ${tags.length} tags in total`);

  // More flexible tag detection with regex patterns
  const stableTagRegex = /^v\d+\.\d+\.\d+$/; // Matches vX.Y.Z format
  const preReleaseRegex = /^(alpha|beta|rc|pre)$/i; // Matches exact alpha/beta/rc/pre tags

  // Get tags for known channels
  const stableTag = tags.find((t) => stableTagRegex.test(t.name));
  const preReleaseTag = tags.find((t) => preReleaseRegex.test(t.name));
  const autobuildTag = tags.find((t) => t.name === AUTOBUILD_SOURCE_TAG_NAME);

  console.log("All tags:", tags.map((t) => t.name).join(", "));
  console.log("Stable tag:", stableTag ? stableTag.name : "None found");
  console.log(
    "Pre-release tag:",
    preReleaseTag ? preReleaseTag.name : "None found",
  );
  console.log(
    "Autobuild tag:",
    autobuildTag ? autobuildTag.name : "None found",
  );
  console.log();

  const channels = [
    {
      name: "stable",
      tagName: stableTag?.name,
      updateReleaseTag: UPDATE_TAG_NAME,
      jsonFile: UPDATE_JSON_FILE,
      proxyFile: UPDATE_JSON_PROXY,
      prerelease: false,
    },
    {
      name: "alpha",
      tagName: preReleaseTag?.name,
      updateReleaseTag: ALPHA_TAG_NAME,
      jsonFile: ALPHA_UPDATE_JSON_FILE,
      proxyFile: ALPHA_UPDATE_JSON_PROXY,
      prerelease: true,
    },
    {
      name: "autobuild",
      tagName: autobuildTag?.name ?? AUTOBUILD_SOURCE_TAG_NAME,
      updateReleaseTag: AUTOBUILD_TAG_NAME,
      jsonFile: AUTOBUILD_UPDATE_JSON_FILE,
      proxyFile: AUTOBUILD_UPDATE_JSON_PROXY,
      prerelease: true,
    },
  ];

  for (const channel of channels) {
    if (!channel.tagName) {
      console.log(`[${channel.name}] tag not found, skipping...`);
      continue;
    }
    await processRelease(github, options, channel);
  }
}

// Process a release and generate update files for the specified channel
async function processRelease(github, options, channelConfig) {
  if (!channelConfig) return;

  const {
    tagName,
    name: channelName,
    updateReleaseTag,
    jsonFile,
    proxyFile,
    prerelease,
  } = channelConfig;

  const channelLabel =
    channelName.charAt(0).toUpperCase() + channelName.slice(1);

  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: tagName,
    });

    const releaseTagName = release.tag_name ?? tagName;

    console.log(
      `[${channelName}] Preparing update metadata from release "${releaseTagName}"`,
    );

    const updateData = {
      name: releaseTagName,
      notes: await resolveUpdateLog(releaseTagName).catch(() =>
        resolveUpdateLogDefault().catch(() => "No changelog available"),
      ),
      pub_date: new Date().toISOString(),
      platforms: {
        win64: { signature: "", url: "" }, // compatible with older formats
        linux: { signature: "", url: "" }, // compatible with older formats
        darwin: { signature: "", url: "" }, // compatible with older formats
        "darwin-aarch64": { signature: "", url: "" },
        "darwin-intel": { signature: "", url: "" },
        "darwin-x86_64": { signature: "", url: "" },
        "linux-x86_64": { signature: "", url: "" },
        "linux-x86": { signature: "", url: "" },
        "linux-i686": { signature: "", url: "" },
        "linux-aarch64": { signature: "", url: "" },
        "linux-armv7": { signature: "", url: "" },
        "windows-x86_64": { signature: "", url: "" },
        "windows-aarch64": { signature: "", url: "" },
        "windows-x86": { signature: "", url: "" },
        "windows-i686": { signature: "", url: "" },
      },
    };

    const promises = release.assets.map(async (asset) => {
      const { name, browser_download_url } = asset;

      // Process all the platform URL and signature data
      // win64 url
      if (name.endsWith("x64-setup.exe")) {
        updateData.platforms.win64.url = browser_download_url;
        updateData.platforms["windows-x86_64"].url = browser_download_url;
      }
      // win64 signature
      if (name.endsWith("x64-setup.exe.sig")) {
        const sig = await getSignature(browser_download_url);
        updateData.platforms.win64.signature = sig;
        updateData.platforms["windows-x86_64"].signature = sig;
      }

      // win32 url
      if (name.endsWith("x86-setup.exe")) {
        updateData.platforms["windows-x86"].url = browser_download_url;
        updateData.platforms["windows-i686"].url = browser_download_url;
      }
      // win32 signature
      if (name.endsWith("x86-setup.exe.sig")) {
        const sig = await getSignature(browser_download_url);
        updateData.platforms["windows-x86"].signature = sig;
        updateData.platforms["windows-i686"].signature = sig;
      }

      // win arm url
      if (name.endsWith("arm64-setup.exe")) {
        updateData.platforms["windows-aarch64"].url = browser_download_url;
      }
      // win arm signature
      if (name.endsWith("arm64-setup.exe.sig")) {
        const sig = await getSignature(browser_download_url);
        updateData.platforms["windows-aarch64"].signature = sig;
      }

      // darwin url (intel)
      if (name.endsWith(".app.tar.gz") && !name.includes("aarch")) {
        updateData.platforms.darwin.url = browser_download_url;
        updateData.platforms["darwin-intel"].url = browser_download_url;
        updateData.platforms["darwin-x86_64"].url = browser_download_url;
      }
      // darwin signature (intel)
      if (name.endsWith(".app.tar.gz.sig") && !name.includes("aarch")) {
        const sig = await getSignature(browser_download_url);
        updateData.platforms.darwin.signature = sig;
        updateData.platforms["darwin-intel"].signature = sig;
        updateData.platforms["darwin-x86_64"].signature = sig;
      }

      // darwin url (aarch)
      if (name.endsWith("aarch64.app.tar.gz")) {
        updateData.platforms["darwin-aarch64"].url = browser_download_url;
        // 使linux可以检查更新
        updateData.platforms.linux.url = browser_download_url;
        updateData.platforms["linux-x86_64"].url = browser_download_url;
        updateData.platforms["linux-x86"].url = browser_download_url;
        updateData.platforms["linux-i686"].url = browser_download_url;
        updateData.platforms["linux-aarch64"].url = browser_download_url;
        updateData.platforms["linux-armv7"].url = browser_download_url;
      }
      // darwin signature (aarch)
      if (name.endsWith("aarch64.app.tar.gz.sig")) {
        const sig = await getSignature(browser_download_url);
        updateData.platforms["darwin-aarch64"].signature = sig;
        updateData.platforms.linux.signature = sig;
        updateData.platforms["linux-x86_64"].signature = sig;
        updateData.platforms["linux-x86"].url = browser_download_url;
        updateData.platforms["linux-i686"].url = browser_download_url;
        updateData.platforms["linux-aarch64"].signature = sig;
        updateData.platforms["linux-armv7"].signature = sig;
      }
    });

    await Promise.allSettled(promises);
    console.log(`[${channelName}] Update data snapshot:`, updateData);

    // maybe should test the signature as well
    // delete the null field
    Object.entries(updateData.platforms).forEach(([key, value]) => {
      if (!value.url) {
        console.log(
          `[${channelName}] [Error]: failed to parse release for "${key}"`,
        );
        delete updateData.platforms[key];
      }
    });

    // Generate a proxy update file for accelerated GitHub resources
    const updateDataNew = JSON.parse(JSON.stringify(updateData));

    Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
      if (value.url) {
        updateDataNew.platforms[key].url =
          "https://download.clashverge.dev/" + value.url;
      } else {
        console.log(
          `[${channelName}] [Error]: updateDataNew.platforms.${key} is null`,
        );
      }
    });

    console.log(
      `[${channelName}] Processing update release target "${updateReleaseTag}"`,
    );

    try {
      let updateRelease;

      try {
        // Try to get the existing release
        const response = await github.rest.repos.getReleaseByTag({
          ...options,
          tag: updateReleaseTag,
        });
        updateRelease = response.data;
        console.log(
          `[${channelName}] Found existing ${updateReleaseTag} release with ID: ${updateRelease.id}`,
        );
      } catch (error) {
        // If release doesn't exist, create it
        if (error.status === 404) {
          console.log(
            `[${channelName}] Release with tag ${updateReleaseTag} not found, creating new release...`,
          );
          const createResponse = await github.rest.repos.createRelease({
            ...options,
            tag_name: updateReleaseTag,
            name: `Auto-update ${channelLabel} Channel`,
            body: `This release contains the update information for the ${channelName} channel.`,
            prerelease,
          });
          updateRelease = createResponse.data;
          console.log(
            `[${channelName}] Created new ${updateReleaseTag} release with ID: ${updateRelease.id}`,
          );
        } else {
          // If it's another error, throw it
          throw error;
        }
      }

      // File names based on release type
      // Delete existing assets with these names
      for (const asset of updateRelease.assets) {
        if (asset.name === jsonFile) {
          await github.rest.repos.deleteReleaseAsset({
            ...options,
            asset_id: asset.id,
          });
        }

        if (asset.name === proxyFile) {
          await github.rest.repos
            .deleteReleaseAsset({ ...options, asset_id: asset.id })
            .catch((deleteError) =>
              console.error(
                `[${channelName}] Failed to delete existing proxy asset:`,
                deleteError.message,
              ),
            ); // do not break the pipeline
        }
      }

      // Upload new assets
      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: jsonFile,
        data: JSON.stringify(updateData, null, 2),
      });

      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: proxyFile,
        data: JSON.stringify(updateDataNew, null, 2),
      });

      console.log(
        `[${channelName}] Successfully uploaded update files to ${updateReleaseTag}`,
      );
    } catch (error) {
      console.error(
        `[${channelName}] Failed to process update release:`,
        error.message,
      );
    }
  } catch (error) {
    if (error.status === 404) {
      console.log(
        `[${channelName}] Release not found for tag: ${tagName}, skipping...`,
      );
    } else {
      console.error(
        `[${channelName}] Failed to get release for tag: ${tagName}`,
        error.message,
      );
    }
  }
}

// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });

  return response.text();
}

resolveUpdater().catch(console.error);
