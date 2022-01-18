import { createRequire } from "module";
import { getOctokit, context } from "@actions/github";

const require = createRequire(import.meta.url);

/// generate update.json
/// upload to update tag's release asset
async function resolveRelease() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const packageJson = require("../package.json");

  const { version } = packageJson;
  const urlPrefix = "https://github.com/zzzgydi/clash-verge/releases/download";
  const updateData = {
    name: `v${version}`,
    notes: `Version ${version} is available now!!!`,
    pub_date: new Date().toISOString(),
    platforms: {
      win64: {
        signature: "",
        url: `${urlPrefix}/v${version}/clash-verge_${version}_x64.msi.zip`,
      },
      darwin: {
        signature: "",
        url: `${urlPrefix}/v${version}/clash-verge.app.tar.gz`,
      },
    },
  };

  console.log(`Generating Version "${version}" update.json`);

  const github = getOctokit(process.env.GITHUB_TOKEN);

  const release = await github.rest.repos.getReleaseByTag("update");
  const { data: assets } = await github.rest.repos.listReleaseAssets({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.id,
  });

  for (let asset of assets) {
    if (asset.name === "update.json") {
      await github.rest.repos.deleteReleaseAsset({
        owner: context.repo.owner,
        repo: context.repo.repo,
        asset_id: asset.id,
      });
      break;
    }
  }

  await github.rest.repos.uploadReleaseAsset({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.id,
    name: "update.json",
    data: JSON.stringify(updateData, null, 2),
  });
}

resolveRelease();
