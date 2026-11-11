# Experimental WiX MSI

Build an MSI from the existing native `target/release` binaries, from the repository root:

```powershell
pnpm build:wix
```

The project pins WiX SDK and its UI/Util extensions to 7.0.0. NuGet restores the
extensions on the first build. `AcceptEula` in the `.wixproj` records acceptance
of the WiX v7 build-tool EULA; it is not an end-user license dialog in the MSI.

When Tauri was built with `pnpm build --target <target>`, pass the same target
to the packaging command. This reads `target/<target>/release` and selects the
matching MSI architecture:

```powershell
pnpm build:wix --target x86_64-pc-windows-msvc
pnpm build:wix --target aarch64-pc-windows-msvc
```

For a Windows GitHub Actions matrix, run `pnpm build:wix --target ${{ matrix.target }}`
after the Tauri build. This experimental command does not publish release assets
or run a Tauri build. Use `--source-dir <directory>` to package another output
directory; `--target` still selects its architecture.

The version is read directly from the root `package.json` at packaging time.
The existing release-version script keeps that version synchronized with
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. No prebuild environment
variable is needed. MSI ProductVersion uses `major.minor.patch`; the full version,
including prerelease/build metadata, is retained in the output filename. The
MSI limits are 255 for major/minor and 65535 for patch.

Output and intermediate files go under `<source-dir>/bundle/wix7/`, separately
for native and target-specific builds. For example, version `2.6.0-rc.1` with
the x64 target produces
`target/x86_64-pc-windows-msvc/release/bundle/wix7/Clash.Verge_2.6.0-rc.1_x64_experimental.msi`.

For direct MSBuild use, supply `AppVersion` explicitly. `SourceDir`,
`InstallerPlatform`, and `AppDisplayVersion` can also be overridden:

```powershell
dotnet build src-tauri/packages/windows/wix/ClashVerge.wixproj -c Release -p:SourceDir=E:\build\release -p:AppVersion=2.6.1
```

The installer defaults to the Windows `ProgramFiles64Folder` plus `Clash Verge`
and lets the user choose another directory. It remembers that directory for
subsequent MSI upgrades. The original file-only experimental MSI did not save
an installation directory; its default directory is used for its first upgrade.

An MSI with the same upgrade code prompts before replacement. Same-version
replacement is intentionally enabled for experimental rebuilds, which produces
an ICE61 validation warning. MSI compares only the first three version fields;
build metadata and fourth-field differences do not prevent a same-version
downgrade. Reopening the identical installed MSI shows repair/removal instead.
NSIS installations are not migrated or detected as related MSI products.

Setup asks the user to exit `clash-verge.exe` from the tray menu. Retry checks
again; Ignore cannot bypass the subsequent blocking check. Only after that
check does Windows Installer stop the registered `clash_verge_service` service
and wait for it to stop before replacing files. The installer does not forcibly
terminate the main application. Service registration and restart remain outside
this experiment, as do prerequisite installation, shortcuts and updater wiring.
Full UI is required for interactive confirmation; unattended installation still
checks for a running application but does not show the wizard.

Authoring references:

- [WiX EULA acceptance](https://docs.firegiant.com/wix/osmf/)
- [Customizing WixUI dialog sets](https://docs.firegiant.com/wix/tools/wixext/wixui/)
- [MajorUpgrade](https://docs.firegiant.com/wix/schema/wxs/majorupgrade/)
- [CloseApplication](https://docs.firegiant.com/wix/schema/util/closeapplication/)
- [ServiceControl](https://docs.firegiant.com/wix/schema/wxs/servicecontrol/)
