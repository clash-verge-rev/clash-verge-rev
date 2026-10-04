param(
    [string]$NdkHome = $env:ANDROID_NDK_HOME
)
$ErrorActionPreference = 'Stop'
if (!$NdkHome) { throw 'Provide -NdkHome or ANDROID_NDK_HOME.' }
$bin = Join-Path $NdkHome 'toolchains/llvm/prebuilt/windows-x86_64/bin'
$clang = Join-Path $bin 'clang.exe'
$linker = Join-Path $bin 'ld.lld.exe'
if (!(Test-Path -LiteralPath $clang) -or !(Test-Path -LiteralPath $linker)) {
    throw 'Android NDK LLVM clang.exe and ld.lld.exe are required.'
}
Push-Location $PSScriptRoot
try {
    $libDir = 'core/src/main/jniLibs/arm64-v8a'
    if (!(Test-Path -LiteralPath (Join-Path $libDir 'libclash.so'))) {
        throw 'Prepare pinned libclash.so before rebuilding the JNI gate.'
    }
    & $clang '--target=aarch64-linux-android21' -ffreestanding -nostdlib -fPIC -shared -O2 '-fuse-ld=lld' '-Wl,-soname,libvergegate.so' '-Wl,-z,max-page-size=16384' -Icore/src/main/cpp/checked core/src/main/cpp/checked/tun_gate.c "-L$libDir" -lclash -o (Join-Path $libDir 'libvergegate.so')
    if ($LASTEXITCODE -ne 0) { throw 'Checked JNI gate build failed.' }
    Get-FileHash -LiteralPath (Join-Path $libDir 'libvergegate.so') -Algorithm SHA256
} finally { Pop-Location }
