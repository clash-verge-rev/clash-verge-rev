import fetch from "node-fetch";
import { getOctokit, context } from "@actions/github";
import { resolveUpdateLog } from "./updatelog.mjs";

const UPDATE_TAG_NAME = "updater";
const UPDATE_JSON_FILE = "update.json";
const UPDATE_JSON_PROXY = "update-proxy.json";

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
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

  console.log(`找到最新发布标签: ${tag.name}`);
  console.log();

  const { data: latestRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: tag.name,
  });

  console.log(`发布资产数量: ${latestRelease.assets.length}`);
  console.log("资产列表:");
  latestRelease.assets.forEach((asset) => {
    console.log(`- ${asset.name}`);
  });
  console.log();

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
    console.log(`处理资产: ${name}`);

    // Windows 资产处理 (v2 格式: 从 -setup.nsis.zip 改为 -setup.exe)
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

    // macOS 资产处理 (v1和v2格式相同)
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
    if (
      name.endsWith("aarch64.app.tar.gz") ||
      (name.endsWith(".dmg") && name.includes("aarch64"))
    ) {
      updateData.platforms["darwin-aarch64"].url = browser_download_url;
    }
    // darwin signature (aarch)
    if (
      name.endsWith("aarch64.app.tar.gz.sig") ||
      (name.endsWith(".dmg.sig") && name.includes("aarch64"))
    ) {
      const sig = await getSignature(browser_download_url);
      updateData.platforms["darwin-aarch64"].signature = sig;
    }

    // Linux 资产处理 (支持 .rpm 和 .deb 包)
    // Linux .rpm 包
    if (name.endsWith(".rpm")) {
      // 根据文件名确定架构
      if (name.includes("x86_64")) {
        updateData.platforms.linux.url = browser_download_url;
        updateData.platforms["linux-x86_64"].url = browser_download_url;
      } else if (name.includes("aarch64")) {
        updateData.platforms["linux-aarch64"].url = browser_download_url;
      } else if (name.includes("armhfp") || name.includes("armhf")) {
        updateData.platforms["linux-armv7"].url = browser_download_url;
      }
    }

    // Linux .rpm 签名
    if (name.endsWith(".rpm.sig")) {
      const sig = await getSignature(browser_download_url);

      // 根据文件名确定架构
      if (name.includes("x86_64")) {
        updateData.platforms.linux.signature = sig;
        updateData.platforms["linux-x86_64"].signature = sig;
      } else if (name.includes("aarch64")) {
        updateData.platforms["linux-aarch64"].signature = sig;
      } else if (name.includes("armhfp") || name.includes("armhf")) {
        updateData.platforms["linux-armv7"].signature = sig;
      }
    }

    // Linux .deb 包
    if (name.endsWith(".deb")) {
      // 根据文件名确定架构
      if (name.includes("amd64")) {
        updateData.platforms.linux.url = browser_download_url;
        updateData.platforms["linux-x86_64"].url = browser_download_url;
      } else if (name.includes("arm64")) {
        updateData.platforms["linux-aarch64"].url = browser_download_url;
      } else if (name.includes("armhf")) {
        updateData.platforms["linux-armv7"].url = browser_download_url;
      } else if (name.includes("i386")) {
        updateData.platforms["linux-x86"].url = browser_download_url;
        updateData.platforms["linux-i686"].url = browser_download_url;
      }
    }

    // Linux .deb 签名
    if (name.endsWith(".deb.sig")) {
      const sig = await getSignature(browser_download_url);

      // 根据文件名确定架构
      if (name.includes("amd64")) {
        updateData.platforms.linux.signature = sig;
        updateData.platforms["linux-x86_64"].signature = sig;
      } else if (name.includes("arm64")) {
        updateData.platforms["linux-aarch64"].signature = sig;
      } else if (name.includes("armhf")) {
        updateData.platforms["linux-armv7"].signature = sig;
      } else if (name.includes("i386")) {
        updateData.platforms["linux-x86"].signature = sig;
        updateData.platforms["linux-i686"].signature = sig;
      }
    }

    // macOS .dmg 包处理 - 专门处理macOS ARM包
    if (name.endsWith(".dmg")) {
      if (name.includes("aarch64") || name.includes("arm64")) {
        updateData.platforms["darwin-aarch64"].url = browser_download_url;
      } else if (name.includes("x86_64") || name.includes("intel")) {
        updateData.platforms.darwin.url = browser_download_url;
        updateData.platforms["darwin-intel"].url = browser_download_url;
        updateData.platforms["darwin-x86_64"].url = browser_download_url;
      }
    }

    // macOS .dmg 签名
    if (name.endsWith(".dmg.sig")) {
      const sig = await getSignature(browser_download_url);
      if (name.includes("aarch64") || name.includes("arm64")) {
        updateData.platforms["darwin-aarch64"].signature = sig;
      } else if (name.includes("x86_64") || name.includes("intel")) {
        updateData.platforms.darwin.signature = sig;
        updateData.platforms["darwin-intel"].signature = sig;
        updateData.platforms["darwin-x86_64"].signature = sig;
      }
    }

    // 仍然保留对 AppImage 的支持，以防将来使用
    if (name.endsWith(".AppImage")) {
      // 根据文件名确定架构
      if (name.includes("x86_64")) {
        updateData.platforms.linux.url = browser_download_url;
        updateData.platforms["linux-x86_64"].url = browser_download_url;
      } else if (name.includes("i686")) {
        updateData.platforms["linux-i686"].url = browser_download_url;
        updateData.platforms["linux-x86"].url = browser_download_url;
      } else if (name.includes("aarch64")) {
        updateData.platforms["linux-aarch64"].url = browser_download_url;
      } else if (name.includes("armv7")) {
        updateData.platforms["linux-armv7"].url = browser_download_url;
      }
    }

    if (name.endsWith(".AppImage.sig")) {
      const sig = await getSignature(browser_download_url);

      // 根据文件名确定架构
      if (name.includes("x86_64")) {
        updateData.platforms.linux.signature = sig;
        updateData.platforms["linux-x86_64"].signature = sig;
      } else if (name.includes("i686")) {
        updateData.platforms["linux-i686"].signature = sig;
        updateData.platforms["linux-x86"].signature = sig;
      } else if (name.includes("aarch64")) {
        updateData.platforms["linux-aarch64"].signature = sig;
      } else if (name.includes("armv7")) {
        updateData.platforms["linux-armv7"].signature = sig;
      }
    }
  });

  // 在处理完所有assets后，确保旧格式平台数据与新格式一致
  await Promise.allSettled(promises);

  console.log("同步新旧格式数据...");

  // 明确同步新旧格式数据
  // Windows
  if (updateData.platforms["windows-x86_64"].url) {
    console.log("同步 win64 与 windows-x86_64 数据");
    updateData.platforms.win64.url = updateData.platforms["windows-x86_64"].url;
    updateData.platforms.win64.signature =
      updateData.platforms["windows-x86_64"].signature;
  }

  // Linux
  if (updateData.platforms["linux-x86_64"].url) {
    console.log("同步 linux 与 linux-x86_64 数据");
    updateData.platforms.linux.url = updateData.platforms["linux-x86_64"].url;
    updateData.platforms.linux.signature =
      updateData.platforms["linux-x86_64"].signature;
  }

  // macOS
  if (updateData.platforms["darwin-x86_64"].url) {
    console.log("同步 darwin 与 darwin-x86_64 数据");
    updateData.platforms.darwin.url = updateData.platforms["darwin-x86_64"].url;
    updateData.platforms.darwin.signature =
      updateData.platforms["darwin-x86_64"].signature;
  } else if (updateData.platforms["darwin-aarch64"].url) {
    console.log("同步 darwin 与 darwin-aarch64 数据");
    updateData.platforms.darwin.url =
      updateData.platforms["darwin-aarch64"].url;
    updateData.platforms.darwin.signature =
      updateData.platforms["darwin-aarch64"].signature;
  }

  console.log("平台数据同步完成，删除空平台数据...");
  console.log(updateData);

  Object.entries(updateData.platforms).forEach(([key, value]) => {
    if (!value.url) {
      console.log(`[Error]: 无法解析平台 "${key}" 的发布资产`);
      delete updateData.platforms[key];
    }
  });

  // 显示最终平台数据
  console.log("最终平台数据:");
  Object.keys(updateData.platforms).forEach((key) => {
    console.log(`- ${key}: ${updateData.platforms[key].url ? "有效" : "无效"}`);
  });

  // 生成一个代理github的更新文件
  // 使用 https://hub.fastgit.xyz/ 做github资源的加速
  const updateDataNew = JSON.parse(JSON.stringify(updateData));

  console.log("处理代理更新文件...");
  Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
    if (value.url) {
      updateDataNew.platforms[key].url =
        "https://download.clashverge.dev/" + value.url;
    } else {
      console.log(`[警告]: updateDataNew.platforms.${key} 为空`);
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

resolveUpdater().catch(console.error);
