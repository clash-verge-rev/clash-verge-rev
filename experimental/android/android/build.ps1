param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$GradlePath = '',
    [switch]$RebuildCheckedTun
)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (!$JavaHome -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) { throw 'Provide -JavaHome or JAVA_HOME for JDK 21.' }
    $javaVersion = (& (Join-Path $JavaHome 'bin/java.exe') --version 2>&1) -join ' '
    if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch '(?:openjdk|java) 21(?:\.|\s)') {
        throw 'This build requires JDK 21. Provide -JavaHome pointing to JDK 21.'
    }
    if ($SdkPath) { $env:ANDROID_HOME = $SdkPath; $env:ANDROID_SDK_ROOT = $SdkPath }
    $env:JAVA_HOME = $JavaHome
    $web = Join-Path $PSScriptRoot '../web/dist/index.html'
    if (Test-Path -LiteralPath $web) {
        New-Item -ItemType Directory -Force app/src/main/assets/web | Out-Null
        Copy-Item -LiteralPath $web -Destination app/src/main/assets/web/index.html
    }
    if (!(Test-Path -LiteralPath app/src/main/assets/web/index.html)) { throw 'Build the shared web UI first.' }
    foreach ($name in @('geoip.metadb', 'geosite.dat', 'ASN.mmdb', 'BundleMRS.7z')) {
        if (!(Test-Path -LiteralPath (Join-Path 'app/src/main/assets' $name))) { throw "Missing $name. Run ../scripts/prepare-android-deps.ps1 first." }
    }
    foreach ($name in @('libclash.so', 'libbridge.so')) {
        if (!(Test-Path -LiteralPath (Join-Path 'core/src/main/jniLibs/arm64-v8a' $name))) { throw "Missing $name. Run ../scripts/prepare-android-deps.ps1 first." }
    }
    if ($RebuildCheckedTun) { & ./build-checked-tun.ps1 }
    if (!(Test-Path -LiteralPath 'core/src/main/jniLibs/arm64-v8a/libvergegate.so')) { throw 'Missing libvergegate.so. Run build-checked-tun.ps1 with Android NDK.' }
    if (!$GradlePath) { $GradlePath = Join-Path $PSScriptRoot 'gradlew.bat' }
    & $GradlePath app:assembleMetaDebug --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed' }
} finally { Pop-Location }
