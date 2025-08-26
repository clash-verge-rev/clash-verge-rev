import { execSync, spawn } from "child_process";
import { consola } from "consola";
import ora from "ora";

consola.info("check typos installed");
const output = execSync("cargo install --list").toString();
const existsTypos = output.includes("typos-cli");
if (!existsTypos) {
  consola.start("Installing typos...");
  const spinner = ora({
    text: "Installing typos",
    color: "yellow",
    spinner: "circle",
  });
  spinner.start();

  const typos = spawn("cargo", ["install", "typos-cli"]);
  typos.stdout.on("data", (data) => {
    spinner.text = data.toString().trim();
  });
  typos.stderr.on("data", (data) => {
    spinner.text = data.toString().trim();
  });
  typos.on("close", (code) => {
    if (code === 0) {
      spinner.succeed();
    } else {
      spinner.fail();
    }
  });
} else {
  consola.success("typos has installed");
}
