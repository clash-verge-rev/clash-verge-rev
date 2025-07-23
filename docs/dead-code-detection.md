# Dead Code Detection Guide

This guide explains how to detect and remove unused code in the Clash Verge project.

## Overview

The project includes tools to analyze both TypeScript/React frontend code and Rust backend code for:
- Unused exports and imports
- Unimported files
- Unused dependencies
- Dead code that's never executed

## Quick Start

```bash
# Install dependencies first
pnpm install

# Run complete dead code analysis
pnpm run check-dead-code

# Clean up detected dead code (WARNING: removes files!)
pnpm run clean-dead-code
```

## Available Scripts

### Analysis Scripts

- `pnpm run check-dead-code` - Run complete analysis and generate report
- `pnpm run check-unused-exports` - Check TypeScript unused exports only
- `pnpm run check-unimported` - Check unimported files and unused dependencies
- `pnpm run check-rust-unused-deps` - Check Rust unused dependencies

### Cleanup Scripts

- `pnpm run clean-dead-code` - Automatically remove detected dead code (USE WITH CAUTION)

## Understanding the Reports

### TypeScript Unused Exports

Shows functions, classes, and types that are exported but never imported:

```
src/components/example.tsx: ExampleComponent, ExampleProps
```

**Action**: Remove unused exports or delete the file if nothing is used.

### Unimported Files

Shows files that exist but are never imported:

```
src/components/unused-component.tsx
```

**Action**: Delete the file if it's truly unused, or add imports if it should be used.

### Unused Dependencies

Shows npm packages that are installed but not used:

```
@types/unused-package
some-unused-library
```

**Action**: Remove from package.json to reduce bundle size.

### Rust Unused Dependencies

Shows Cargo dependencies that aren't used:

```
unused-crate
```

**Action**: Remove from Cargo.toml, but be careful with build dependencies.

## Safe Cleanup Process

1. **Always commit your changes first**
2. **Run the analysis**: `pnpm run check-dead-code`
3. **Review the report**: Check `dead-code-report.md`
4. **Manual cleanup**: Remove files and dependencies carefully
5. **Test thoroughly**: Run `pnpm run web:build` and test the app
6. **Alternative**: Use `pnpm run clean-dead-code` for automatic cleanup

## Configuration

### TypeScript Configuration

Edit `.ts-unused-exports.json` to customize which files to analyze:

```json
{
  "entry": ["src/main.tsx"],
  "extensions": [".ts", ".tsx"],
  "ignorePatterns": ["**/*.test.*", "**/*.spec.*"]
}
```

### Unimported Configuration

Edit `.unimportedrc.json` to customize import analysis:

```json
{
  "entry": ["src/main.tsx"],
  "ignoreUnimported": ["src/assets/**"],
  "ignoreUnresolved": true
}
```

## Common Issues

### False Positives

Some code might be marked as unused but is actually needed:

- **Dynamic imports**: Code loaded conditionally
- **Build dependencies**: Used in build scripts
- **Type-only imports**: TypeScript types
- **Asset imports**: Images, SVGs loaded by bundler

### Build Dependencies

Some Rust dependencies are used in `build.rs` or as proc-macros. These can be ignored by adding to `Cargo.toml`:

```toml
[package.metadata.cargo-machete]
ignored = ["tauri-build", "serde_derive"]
```

## Best Practices

1. **Run analysis regularly** - Add to CI/CD pipeline
2. **Review before removing** - Don't blindly delete everything
3. **Test after cleanup** - Ensure app still works
4. **Document exceptions** - Add ignored patterns for legitimate unused code
5. **Small incremental changes** - Remove a few files at a time

## Troubleshooting

### "Command not found" errors

Make sure you've installed dependencies:
```bash
pnpm install
```

### TypeScript compilation errors

Some unused code might be needed for type checking. Review carefully before removing.

### Rust compilation errors

Some dependencies might be used indirectly. Check build.rs and macro usage.

## Integration with CI/CD

Add to your workflow:

```yaml
- name: Check for dead code
  run: |
    pnpm install
    pnpm run check-dead-code
    
- name: Fail if dead code found
  run: |
    if [ -s dead-code-report.md ]; then
      echo "Dead code detected!"
      exit 1
    fi
```

## Manual Analysis Commands

For advanced users, you can run the underlying tools directly:

```bash
# TypeScript unused exports
npx ts-unused-exports tsconfig.json --excludeDeclarationFiles

# Unimported files analysis
npx unimported --no-cache

# Rust unused dependencies
cargo machete --with-metadata ./src-tauri/Cargo.toml

# Rust dead code warnings
cargo clippy --manifest-path ./src-tauri/Cargo.toml -- -W dead_code
```