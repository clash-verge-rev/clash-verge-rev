import fetch from "node-fetch";
import { getOctokit, context } from "@actions/github";

const UPDATE_TAG_NAME = "updater";
const UPDATE_JSON_FILE = "update.json";

/// generate update.json
/// upload to update tag's release asset
async function resolveRelease() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);

  const { data: tags } = await github.rest.repos.listTags({
    ...options,
    per_page: 10,
    page: 1,
  });

  // get the latest publish tag
  const tag = tags.find((t) => t.name.startsWith("v"));

  console.log(tag);
  console.log();

  const { data: latestRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: tag.name,
  });

  const updateData = {
    name: tag.name,
    notes: latestRelease.body, // use the release body directly
    pub_date: new Date().toISOString(),
    platforms: {
      win64: { signature: "", url: "" },
      darwin: { signature: "", url: "" },
    },
  };

  const promises = latestRelease.assets.map(async (asset) => {
    const { name, browser_download_url } = asset;

    // win64 url
    if (/\.msi\.zip$/.test(name)) {
      updateData.platforms.win64.url = browser_download_url;
    }
    // darwin url
    if (/\.app\.tar\.gz$/.test(name)) {
      updateData.platforms.darwin.url = browser_download_url;
    }
    // win64 signature
    if (/\.msi\.zip\.sig$/.test(name)) {
      updateData.platforms.win64.signature = await getSignature(
        browser_download_url
      );
    }
    // darwin signature
    if (/\.app\.tar\.gz\.sig$/.test(name)) {
      updateData.platforms.darwin.signature = await getSignature(
        browser_download_url
      );
    }
  });

  await Promise.allSettled(promises);
  console.log(updateData);

  // maybe should test the signature as well
  const { darwin, win64 } = updateData.platforms;
  if (!darwin.url) {
    console.log(`[Error]: failed to parse release for darwin`);
    delete updateData.platforms.darwin;
  }
  if (!win64.url) {
    console.log(`[Error]: failed to parse release for win64`);
    delete updateData.platforms.win64;
  }

  // update the update.json
  const { data: updateRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: UPDATE_TAG_NAME,
  });

  for (let asset of updateRelease.assets) {
    if (asset.name === UPDATE_JSON_FILE) {
      await github.rest.repos.deleteReleaseAsset({
        ...options,
        asset_id: asset.id,
      });
      break;
    }
  }

  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: UPDATE_JSON_FILE,
    data: JSON.stringify(updateData, null, 2),
  });
}

// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });

  return response.text();
}

resolveRelease().catch(console.error);
