import { context, getOctokit } from "@actions/github";
import fs from "fs-extra";
import fetch from "node-fetch";
import path from "path";

const cwd = process.cwd();
const arg = process.argv.slice(2)[0];

// release version info file
const UPDATE_TAG_NAME = "updater";
const UPDATE_JSON_FILE = "update.json";
const UPDATE_JSON_PROXY = "update-proxy.json";

// log file
const CHANGE_LOG = "CHANGELOG.md";
const UPDATE_LOG = "UPDATELOG.md";
const update_log_file = path.join(cwd, UPDATE_LOG);
const change_log_file = path.join(cwd, CHANGE_LOG);

export async function getLatestTag() {
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

  return tag;
}

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
  const tag = await getLatestTag();
  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);
  const { data: latestRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: tag.name,
  });

  const updateData = {
    name: tag.name,
    notes: await resolveUpdateLog(tag.name), // use updatelog.md
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

  const promises = latestRelease.assets.map(async (asset) => {
    const { name, browser_download_url } = asset;

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
  console.log(updateData);

  // maybe should test the signature as well
  // delete the null field
  Object.entries(updateData.platforms).forEach(([key, value]) => {
    if (!value.url) {
      console.log(`[Error]: failed to parse release for "${key}"`);
      delete updateData.platforms[key];
    }
  });

  // 生成一个代理github的更新文件
  // 使用 https://hub.fastgit.xyz/ 做github资源的加速
  const updateDataNew = JSON.parse(JSON.stringify(updateData));

  Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
    if (value.url) {
      updateDataNew.platforms[key].url = "https://ghp.ci/" + value.url;
    } else {
      console.log(`[Error]: updateDataNew.platforms.${key} is null`);
    }
  });

  // update the update.json
  const { data: updateRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: UPDATE_TAG_NAME,
  });

  // delete the old assets
  for (let asset of updateRelease.assets) {
    if (asset.name === UPDATE_JSON_FILE) {
      await github.rest.repos.deleteReleaseAsset({
        ...options,
        asset_id: asset.id,
      });
    }

    if (asset.name === UPDATE_JSON_PROXY) {
      await github.rest.repos
        .deleteReleaseAsset({ ...options, asset_id: asset.id })
        .catch(console.error); // do not break the pipeline
    }
  }

  // upload new assets
  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: UPDATE_JSON_FILE,
    data: JSON.stringify(updateData, null, 2),
  });

  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: UPDATE_JSON_PROXY,
    data: JSON.stringify(updateDataNew, null, 2),
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

// parse the UPDATELOG.md
export async function resolveUpdateLog(tag) {
  const reTitle = /^## v[\d\.]+/;
  const reEnd = /^---/;

  if (!(await fs.pathExists(update_log_file))) {
    throw new Error("could not found UPDATELOG.md");
  }

  const data = await fs
    .readFile(update_log_file)
    .then((d) => d.toString("utf8"));

  const map = {};
  let p = "";

  data.split("\n").forEach((line) => {
    if (reTitle.test(line)) {
      p = line.slice(3).trim();
      if (!map[p]) {
        map[p] = [];
      } else {
        throw new Error(`Tag ${p} dup`);
      }
    } else if (reEnd.test(line)) {
      p = "";
    } else if (p) {
      map[p].push(line);
    }
  });

  if (!map[tag]) {
    throw new Error(`could not found "${tag}" in UPDATELOG.md`);
  }

  return map[tag].join("\n").trim();
}

export async function updateUpdateLog() {
  const tag = await getLatestTag();
  const tagTitle = `## ${tag.name}`;
  // write all change log content to update log file
  const changeLogContent = await fs
    .readFile(change_log_file)
    .then((d) => d.toString("utf8"));
  const updateLogContent = await fs
    .readFile(update_log_file)
    .then((d) => d.toString("utf8"));
  const regexp = new RegExp("## (v.*)", "g");
  let allVersions = [...updateLogContent.matchAll(regexp)].map((match) =>
    match[1].trim(),
  );
  console.log(allVersions);
  if (!allVersions.includes(tag.name)) {
    const prependContent = `${tagTitle}\n\n${changeLogContent}\n---\n\n`;
    const finaleUpdateLogContent = prependContent.concat(updateLogContent);
    await fs.writeFile(update_log_file, finaleUpdateLogContent);
    // generate default change log file
    const defaultChangeLog = `<!--
### 🚨 Breaking Changes

### ✨ Features

### 🐛 Bug Fixes

-->`;
    await fs.writeFile(change_log_file, defaultChangeLog);
  } else {
    throw new Error(`${tag.name} already exists in UPDATELOG.md`);
  }
}

if (arg === "--changelog") {
  updateUpdateLog().catch(console.error);
} else {
  resolveUpdater().catch(console.error);
}
