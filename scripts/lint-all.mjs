#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { exit } from "process";

// Function to run a command
function runCommand(command, args, cwd = ".") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd, shell: true });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`${command} ${args.join(" ")} exited with code ${code}`),
        );
      }
    });
  });
}

// Function to check if a command exists
function commandExists(command) {
  try {
    const result = spawnSync(command, ["--version"], { stdio: "pipe" });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

async function lintAll() {
  console.log("Starting comprehensive lint process...");

  try {
    // Run TypeScript/JavaScript linting
    console.log("\n--- Linting TypeScript/JavaScript files ---");
    await runCommand("pnpm", ["lint"]);

    // Run TypeScript type checking
    console.log("\n--- Type checking ---");
    await runCommand("pnpm", ["type-check"]);

    // Run prettier check
    console.log("\n--- Checking formatting ---");
    await runCommand("pnpm", ["format:check"]);

    console.log("\n--- Linting Rust files ---");

    // Check for rustfmt
    if (!commandExists("cargo")) {
      throw new Error("Cargo is not available. Please install Rust and Cargo.");
    }

    // Run rustfmt
    console.log("Running rustfmt...");
    await runCommand("cargo", ["fmt", "--", "--check"], "./src-tauri");

    // Run clippy
    console.log("Running clippy...");
    await runCommand(
      "cargo",
      ["clippy", "--", "-D", "warnings"],
      "./src-tauri",
    );

    console.log("\n✅ All linting checks passed!");
  } catch (error) {
    console.error("\n[ERROR] Linting failed:", error.message);
    exit(1);
  }
}

lintAll();
