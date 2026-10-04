param(
    [string]$ApkPath = ''
)
$ErrorActionPreference = 'Stop'
$url = 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases/download/v2.11.35/cmfa-2.11.35-meta-arm64-v8a-release.apk'
$apkSha256 = 'af7f05d8801798a8e75de682e5f67070138becb8623b7a341c3e5cd042a3753d'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$inputs = @(
    @{ Entry = 'lib/arm64-v8a/libbridge.so'; Target = 'android/core/src/main/jniLibs/arm64-v8a/libbridge.so'; Hash = '944b9b1201641fdd468ddf09e64d9c5e9be24587737e3a1cac43ec91e5c3a95b' },
    @{ Entry = 'lib/arm64-v8a/libclash.so'; Target = 'android/core/src/main/jniLibs/arm64-v8a/libclash.so'; Hash = 'bd30767c01b4e255279242fc77008671bb08db330c0a106a0144ecebaa482721' },
    @{ Entry = 'assets/geoip.metadb'; Target = 'android/app/src/main/assets/geoip.metadb'; Hash = '76ad4ba5d45b1d35b57c3ef26a31c420f7e5afa1e03baf18a47f2d2c933f783b' },
    @{ Entry = 'assets/geosite.dat'; Target = 'android/app/src/main/assets/geosite.dat'; Hash = 'bff76f6b4d87c3a4c7d9612b926e762b21ba4fe2c5bf8c5a43af25fe8de71b7e' },
    @{ Entry = 'assets/ASN.mmdb'; Target = 'android/app/src/main/assets/ASN.mmdb'; Hash = 'd8a649084d78e662cc7091ec64840c4ab534eef33e573649697fee253f2f9f4c' },
    @{ Entry = 'assets/BundleMRS.7z'; Target = 'android/app/src/main/assets/BundleMRS.7z'; Hash = '0f02c1038b9a41d9961a1bc5596b43b8bfb2cd7ba635e09c7e85c00f07608d15' }
)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('verge-mobile-deps-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    if (!$ApkPath) {
        $ApkPath = Join-Path $temporary 'official.apk'
        Invoke-WebRequest -Uri $url -OutFile $ApkPath -MaximumRedirection 5
    }
    $apk = (Resolve-Path -LiteralPath $ApkPath).Path
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $apkSha256) {
        throw 'Official APK SHA256 mismatch. No inputs were installed.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        foreach ($input in $inputs) {
            $entry = $zip.GetEntry($input.Entry)
            if ($null -eq $entry) { throw "Missing APK entry: $($input.Entry)" }
            $staged = Join-Path $temporary ([IO.Path]::GetFileName($input.Entry))
            $source = $entry.Open()
            try {
                $destination = [IO.File]::Open($staged, [IO.FileMode]::CreateNew)
                try { $source.CopyTo($destination) } finally { $destination.Dispose() }
            } finally { $source.Dispose() }
            if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $input.Hash) {
                throw "Extracted entry SHA256 mismatch: $($input.Entry)"
            }
        }
    } finally { $zip.Dispose() }
    foreach ($input in $inputs) {
        $target = Join-Path $root $input.Target
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $temporary ([IO.Path]::GetFileName($input.Entry))) -Destination $target -Force
        Write-Output "Prepared $($input.Target)"
    }
    Write-Output 'All pinned APK inputs verified. Build libvergegate.so from source with android/build-checked-tun.ps1.'
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
