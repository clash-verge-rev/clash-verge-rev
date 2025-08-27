import { execSync, spawn } from "child_process";
import { consola } from "consola";
import ora from "ora";

async function installRustBinary(binaryName, command, args) {
  return new Promise((resolve, reject) => {
    consola.start(`Installing ${binaryName}...`);
    const spinner = ora({
      text: `Installing ${binaryName}`,
      color: "yellow",
      spinner: "circle",
    });
    spinner.start();

    const child = spawn(command, args);
    child.stdout.on("data", (data) => {
      spinner.text = data.toString().trim();
    });
    child.stderr.on("data", (data) => {
      spinner.text = data.toString().trim();
    });
    child.on("close", (code) => {
      if (code === 0) {
        spinner.succeed();
        resolve();
      } else {
        spinner.fail();
        reject(new Error(`Process exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

const isGithubAction = process.env.GITHUB_TOKEN !== undefined;
if (!isGithubAction) {
  const output = execSync("cargo install --list").toString();
  // typos
  // consola.info("check typos installed");
  // const existsTypos = output.includes("typos-cli");
  // if (!existsTypos) {
  //   await installRustBinary("typos", "cargo", ["install", "typos-cli"]);
  // } else {
  //   consola.success("typos has installed");
  // }

  // prek
  consola.info("check prek installed");
  const existsPrek = output.includes("prek");
  if (!existsPrek) {
    await installRustBinary("prek", "cargo", [
      "install",
      "--locked",
      "--git",
      "https://github.com/j178/prek",
    ]);
  } else {
    consola.success("prek has installed");
  }
}
