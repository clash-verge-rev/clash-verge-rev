#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

function log(message, color = 'white') {
  console.log(colors[color] + message + colors.reset);
}

function runCommand(command, args = [], cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

// List of files that are likely safe to remove based on our analysis
const SAFE_TO_REMOVE_FILES = [
  'src/pages/test.tsx',
  'src/components/center.tsx',
  'src/components/setting/mods/password-input.tsx',
  'src/hooks/use-current-proxy.ts',
  'src/hooks/useNotificationPermission.ts',
  'src/utils/ignore-case.ts',
  'src/utils/notification-permission.ts'
];

// Dependencies that are likely safe to remove
const SAFE_TO_REMOVE_DEPS = [
  '@tauri-apps/plugin-global-shortcut',
  '@tauri-apps/plugin-notification',
  '@tauri-apps/plugin-window-state',
  '@types/json-schema',
  'cli-color',
  'glob',
  'tar'
];

// Rust dependencies that might be safe to remove
const RUST_DEPS_TO_CONSIDER = [
  'async-trait',
  'image',
  'tempfile'
];

async function removeUnusedFiles() {
  log('\n🧹 Removing unused files...', 'cyan');
  
  let filesRemoved = 0;
  
  for (const file of SAFE_TO_REMOVE_FILES) {
    const filePath = path.join(process.cwd(), file);
    
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        log(`✅ Removed: ${file}`, 'green');
        filesRemoved++;
      } catch (error) {
        log(`❌ Failed to remove ${file}: ${error.message}`, 'red');
      }
    } else {
      log(`⚠️  File not found: ${file}`, 'yellow');
    }
  }
  
  log(`\n📊 Removed ${filesRemoved} files`, 'blue');
}

async function removeUnusedDependencies() {
  log('\n🧹 Removing unused dependencies...', 'cyan');
  
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    log('❌ package.json not found', 'red');
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  let depsRemoved = 0;
  
  for (const dep of SAFE_TO_REMOVE_DEPS) {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      delete packageJson.dependencies[dep];
      log(`✅ Removed dependency: ${dep}`, 'green');
      depsRemoved++;
    } else if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
      delete packageJson.devDependencies[dep];
      log(`✅ Removed dev dependency: ${dep}`, 'green');
      depsRemoved++;
    } else {
      log(`⚠️  Dependency not found: ${dep}`, 'yellow');
    }
  }
  
  if (depsRemoved > 0) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    log(`\n📊 Removed ${depsRemoved} dependencies from package.json`, 'blue');
  }
}

async function updateCargoToml() {
  log('\n🧹 Updating Cargo.toml to ignore some dependencies...', 'cyan');
  
  const cargoPath = path.join(process.cwd(), 'src-tauri', 'Cargo.toml');
  
  if (!fs.existsSync(cargoPath)) {
    log('❌ Cargo.toml not found', 'red');
    return;
  }
  
  const cargoContent = fs.readFileSync(cargoPath, 'utf8');
  
  // Add metadata section to ignore some dependencies that might be used indirectly
  const metadataSection = `
[package.metadata.cargo-machete]
ignored = ["tauri-build"]  # Used in build.rs
`;
  
  if (!cargoContent.includes('[package.metadata.cargo-machete]')) {
    const updatedContent = cargoContent + metadataSection;
    fs.writeFileSync(cargoPath, updatedContent);
    log('✅ Added cargo-machete ignore list to Cargo.toml', 'green');
  } else {
    log('⚠️  Cargo.toml already contains metadata section', 'yellow');
  }
}

async function runPnpmInstall() {
  log('\n📦 Running pnpm install to update lock file...', 'cyan');
  
  try {
    const result = await runCommand('pnpm', ['install']);
    if (result.code === 0) {
      log('✅ pnpm install completed successfully', 'green');
    } else {
      log('❌ pnpm install failed:', 'red');
      console.log(result.stderr);
    }
  } catch (error) {
    log('❌ Failed to run pnpm install: ' + error.message, 'red');
  }
}

async function generateCleanupSummary() {
  log('\n📊 Generating cleanup summary...', 'magenta');
  
  const summaryPath = path.join(process.cwd(), 'cleanup-summary.md');
  const timestamp = new Date().toISOString();
  
  let summary = `# Dead Code Cleanup Summary\n\n`;
  summary += `Generated at: ${timestamp}\n\n`;
  summary += `## Files Removed\n\n`;
  
  for (const file of SAFE_TO_REMOVE_FILES) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      summary += `- ✅ ${file}\n`;
    } else {
      summary += `- ⚠️ ${file} (still exists)\n`;
    }
  }
  
  summary += `\n## Dependencies Removed\n\n`;
  
  for (const dep of SAFE_TO_REMOVE_DEPS) {
    summary += `- ✅ ${dep}\n`;
  }
  
  summary += `\n## Next Steps\n\n`;
  summary += `1. Run the tests to ensure nothing is broken\n`;
  summary += `2. Review the remaining unused exports manually\n`;
  summary += `3. Consider removing unused Rust dependencies: ${RUST_DEPS_TO_CONSIDER.join(', ')}\n`;
  summary += `4. Set up ESLint rules to prevent future unused code\n\n`;
  
  fs.writeFileSync(summaryPath, summary);
  log(`📄 Cleanup summary generated: ${summaryPath}`, 'green');
}

async function main() {
  log('🚀 Starting dead code cleanup...', 'blue');
  
  // Check if we're in the right directory
  if (!fs.existsSync('./package.json') || !fs.existsSync('./src-tauri/Cargo.toml')) {
    log('❌ Error: Must be run from the project root directory', 'red');
    process.exit(1);
  }
  
  // Warn user about the changes
  log('\n⚠️  WARNING: This script will remove files and dependencies!', 'yellow');
  log('⚠️  Make sure you have committed your changes first!', 'yellow');
  log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...', 'yellow');
  
  // Wait 5 seconds
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    await removeUnusedFiles();
    await removeUnusedDependencies();
    await updateCargoToml();
    await runPnpmInstall();
    await generateCleanupSummary();
    
    log('\n🎉 Dead code cleanup completed!', 'green');
    log('📄 Check cleanup-summary.md for details', 'cyan');
    log('⚠️  Please run tests to ensure everything still works', 'yellow');
  } catch (error) {
    log('\n❌ Error during cleanup: ' + error.message, 'red');
    process.exit(1);
  }
}

if (import.meta.url === new URL(import.meta.url).href) {
  main();
}

export {
  removeUnusedFiles,
  removeUnusedDependencies,
  updateCargoToml,
  runPnpmInstall,
  generateCleanupSummary
};