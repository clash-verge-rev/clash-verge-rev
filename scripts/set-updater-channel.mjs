import fs from "fs/promises";
import path from "path";
import process from "process";

const [channel] = process.argv.slice(2);
if (!channel) {
  console.error("[updater] channel argument is required (stable|autobuild)");
  process.exit(1);
}

const repositoryDownloadBase =
  "https://github.com/clash-verge-rev/clash-verge-rev/releases/download";

const channelMap = {
  stable: "updater",
  autobuild: "updater-autobuild",
};

const releasePath = channelMap[channel];

if (!releasePath) {
  console.error(
    `[updater] unsupported channel "${channel}". Expected one of: ${Object.keys(channelMap).join(", ")}`,
  );
  process.exit(1);
}

const endpoints = [
  `https://download.clashverge.dev/${repositoryDownloadBase}/${releasePath}/update-proxy.json`,
  `https://gh-proxy.com/${repositoryDownloadBase}/${releasePath}/update-proxy.json`,
  `${repositoryDownloadBase}/${releasePath}/update.json`,
];

const configPath = path.resolve(process.cwd(), "src-tauri", "tauri.conf.json");

async function main() {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(raw);

    config.plugins ??= {};
    config.plugins.updater ??= {};
    config.plugins.updater.endpoints = endpoints;

    await fs.writeFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `[updater] endpoints set to ${channel} channel:`,
      config.plugins.updater.endpoints,
    );
  } catch (error) {
    console.error("[updater] failed to update tauri.conf.json:", error);
    process.exit(1);
  }
}

main();
