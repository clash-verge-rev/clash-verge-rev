import fs from "fs-extra";
import path from "path";
import { getLatestTag } from "./updater.mjs";

const cwd = process.cwd();
const CHANGELOG = "CHANGELOG.txt";
const UPDATE_LOG = "UPDATELOG.md";
const update_log_file = path.join(cwd, UPDATE_LOG);
const change_log_file = path.join(cwd, CHANGELOG);

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
  const tagTitle = `## v${tag}`;
  // write all change log content to update log file
  const changeLogContent = await fs
    .readFile(change_log_file)
    .then((d) => d.toString("utf8"));
  const updateLogContent = await fs
    .readFile(update_log_file)
    .then((d) => d.toString("utf8"));
  if (!updateLogContent.includes(tagTitle)) {
    const prependContent = `${tagTitle}\n${changeLogContent}\n---\n\n`;
    const finaleUpdateLogContent = prependContent.concat(updateLogContent);
    await fs.writeFile(update_log_file, finaleUpdateLogContent);
    // clean change log file
    await fs.writeFile(change_log_file, "");
  } else {
    console.log(`v${tag} already exists in UPDATELOG.md`);
  }
}

updateUpdateLog();
