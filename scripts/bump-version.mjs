import fs from "fs-extra";
import path from "path";

const cwd = process.cwd();
let process_argvs = process.argv;
if (process_argvs.length !== 3) {
  throw new Error("invalid arguments, please provide a version");
}

// all version file
const changeJsonFile = ["package.json", "./src-tauri/tauri.conf.json"];
const changeFile = [
  "./src-tauri/Cargo.toml",
  "./archbuild/alpha/PKGBUILD",
  "./archbuild/local_build/PKGBUILD",
  "./archbuild/release/PKGBUILD",
];

const version = process_argvs[2];
const versionExp = /^\d+\.\d+\.\d+(-[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/;
if (!versionExp.test(version)) {
  throw new Error("invalid version format");
}

for (const file of changeJsonFile) {
  const filePath = path.join(cwd, file);
  let data = fs.readFileSync(filePath, "utf8");
  let jsonData = JSON.parse(data);
  jsonData.version = version;
  fs.writeFileSync(file, JSON.stringify(jsonData, null, 2));
}

for (const file of changeFile) {
  const filePath = path.join(cwd, file);
  let data = fs.readFileSync(filePath, "utf8");
  if (data.includes("version = ")) {
    data = data.replace(/version = ".*"/, `version = "${version}"`);
  }
  if (data.includes("pkgver=")) {
    // 正向后行断言 (?<=)
    const aurVersion = version.replace(/-|(?<=-.*?)\./g, "_");
    data = data.replace(/pkgver=.*/, `pkgver=${aurVersion}`);
    data = data.replace(/_pkgver=.*/, `_pkgver=${version}`);
  }
  fs.writeFileSync(file, data);
}
