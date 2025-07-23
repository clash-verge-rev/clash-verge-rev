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

async function checkTypeScriptUnusedExports() {
  log('\n🔍 Checking TypeScript unused exports...', 'cyan');
  
  try {
    const result = await runCommand('npx', ['ts-unused-exports', 'tsconfig.json', '--excludeDeclarationFiles']);
    
    if (result.code === 0) {
      if (result.stdout.trim()) {
        log('✅ No unused exports found', 'green');
        return { status: 'success', message: 'No unused exports found' };
      } else {
        log('✅ No unused exports found', 'green');
        return { status: 'success', message: 'No unused exports found' };
      }
    } else {
      if (result.stdout.trim()) {
        log('❌ Found unused exports:', 'red');
        console.log(result.stdout);
        return { status: 'found_issues', message: result.stdout };
      } else {
        log('⚠️  Error running ts-unused-exports:', 'yellow');
        console.log(result.stderr);
        return { status: 'error', message: result.stderr };
      }
    }
  } catch (error) {
    log('⚠️  Failed to run ts-unused-exports: ' + error.message, 'yellow');
    return { status: 'error', message: error.message };
  }
}

async function checkUnimportedFiles() {
  log('\n🔍 Checking unimported files...', 'cyan');
  
  try {
    const result = await runCommand('npx', ['unimported', '--no-cache']);
    
    if (result.code === 0) {
      if (result.stdout.trim()) {
        log('✅ No unimported files found', 'green');
        return { status: 'success', message: 'No unimported files found' };
      } else {
        log('✅ No unimported files found', 'green');
        return { status: 'success', message: 'No unimported files found' };
      }
    } else {
      if (result.stdout.includes('unimported files') || result.stdout.includes('unused dependencies')) {
        log('❌ Found unimported files/unused dependencies:', 'red');
        console.log(result.stdout);
        return { status: 'found_issues', message: result.stdout };
      } else {
        log('⚠️  Error running unimported:', 'yellow');
        console.log(result.stderr);
        return { status: 'error', message: result.stderr };
      }
    }
  } catch (error) {
    log('⚠️  Failed to run unimported: ' + error.message, 'yellow');
    return { status: 'error', message: error.message };
  }
}

async function checkRustDeadCode() {
  log('\n🔍 Checking Rust dead code...', 'cyan');
  
  try {
    const result = await runCommand('cargo', ['rustc', '--manifest-path', './src-tauri/Cargo.toml', '--', '-W', 'dead_code']);
    
    if (result.code === 0) {
      log('✅ Rust compilation passed', 'green');
    } else {
      if (result.stderr.includes('dead_code')) {
        log('❌ Found dead code in Rust:', 'red');
        console.log(result.stderr);
      } else {
        log('⚠️  Rust compilation failed:', 'yellow');
        console.log(result.stderr);
      }
    }
  } catch (error) {
    log('⚠️  Failed to run Rust dead code check: ' + error.message, 'yellow');
  }
}

async function checkRustUnusedDependencies() {
  log('\n🔍 Checking Rust unused dependencies...', 'cyan');
  
  try {
    const result = await runCommand('cargo', ['machete', '--with-metadata', './src-tauri/Cargo.toml']);
    
    if (result.code === 0) {
      if (result.stdout.trim()) {
        log('✅ No unused dependencies found', 'green');
        return { status: 'success', message: 'No unused dependencies found' };
      } else {
        log('✅ No unused dependencies found', 'green');
        return { status: 'success', message: 'No unused dependencies found' };
      }
    } else {
      if (result.stdout.includes('unused dependencies')) {
        log('❌ Found unused dependencies:', 'red');
        console.log(result.stdout);
        return { status: 'found_issues', message: result.stdout };
      } else {
        log('⚠️  Error running cargo machete:', 'yellow');
        console.log(result.stderr);
        return { status: 'error', message: result.stderr };
      }
    }
  } catch (error) {
    log('⚠️  Failed to run cargo machete: ' + error.message, 'yellow');
    return { status: 'error', message: error.message };
  }
}

async function checkTypeScriptWithCompiler() {
  log('\n🔍 Checking TypeScript compilation for unused code...', 'cyan');
  
  try {
    const result = await runCommand('npx', ['tsc', '--noEmit', '--noUnusedLocals', '--noUnusedParameters']);
    
    if (result.code === 0) {
      log('✅ TypeScript compilation passed with unused code checks', 'green');
    } else {
      log('❌ TypeScript compilation found unused code:', 'red');
      console.log(result.stderr);
    }
  } catch (error) {
    log('⚠️  Failed to run TypeScript compiler: ' + error.message, 'yellow');
  }
}

async function generateReport() {
  log('\n📊 Generating dead code report...', 'magenta');
  
  const reportPath = path.join(__dirname, '..', 'dead-code-report.md');
  const timestamp = new Date().toISOString();
  
  let report = `# Dead Code Analysis Report\n\n`;
  report += `Generated at: ${timestamp}\n\n`;
  
  // Run all checks and capture results
  const checks = [
    { name: 'TypeScript Unused Exports', fn: checkTypeScriptUnusedExports },
    { name: 'Unimported Files', fn: checkUnimportedFiles },
    { name: 'Rust Unused Dependencies', fn: checkRustUnusedDependencies },
  ];
  
  let foundIssues = false;
  
  for (const check of checks) {
    report += `## ${check.name}\n\n`;
    try {
      const result = await check.fn();
      if (result.status === 'found_issues') {
        foundIssues = true;
        report += `❌ Issues found:\n\n\`\`\`\n${result.message}\n\`\`\`\n\n`;
      } else if (result.status === 'success') {
        report += `✅ ${result.message}\n\n`;
      } else {
        report += `⚠️ Check failed: ${result.message}\n\n`;
      }
    } catch (error) {
      report += `❌ Check failed: ${error.message}\n\n`;
    }
  }
  
  if (foundIssues) {
    report += `## Summary\n\n`;
    report += `❌ Dead code and unused dependencies were found. Please review the results above.\n\n`;
    report += `## Recommended Actions\n\n`;
    report += `1. Remove unused exports from TypeScript files\n`;
    report += `2. Delete unimported files if they're no longer needed\n`;
    report += `3. Remove unused dependencies from package.json and Cargo.toml\n`;
    report += `4. Consider adding eslint rules to prevent unused code in the future\n\n`;
  } else {
    report += `## Summary\n\n`;
    report += `✅ No dead code or unused dependencies found!\n\n`;
  }
  
  fs.writeFileSync(reportPath, report);
  log(`📄 Report generated: ${reportPath}`, 'green');
  
  return foundIssues;
}

async function main() {
  log('🚀 Starting dead code analysis...', 'blue');
  
  // Check if we're in the right directory
  if (!fs.existsSync('./package.json') || !fs.existsSync('./src-tauri/Cargo.toml')) {
    log('❌ Error: Must be run from the project root directory', 'red');
    process.exit(1);
  }
  
  try {
    const tsExports = await checkTypeScriptUnusedExports();
    const unimported = await checkUnimportedFiles();
    const rustDeps = await checkRustUnusedDependencies();
    
    const foundIssues = await generateReport();
    
    if (foundIssues) {
      log('\n⚠️  Dead code analysis completed with issues found!', 'yellow');
      log('📄 Check the generated report for details: dead-code-report.md', 'cyan');
    } else {
      log('\n🎉 Dead code analysis completed - no issues found!', 'green');
    }
  } catch (error) {
    log('\n❌ Error during analysis: ' + error.message, 'red');
    process.exit(1);
  }
}

if (import.meta.url === new URL(import.meta.url).href) {
  main();
}

export {
  checkTypeScriptUnusedExports,
  checkUnimportedFiles,
  checkRustDeadCode,
  checkRustUnusedDependencies,
  checkTypeScriptWithCompiler,
  generateReport
};