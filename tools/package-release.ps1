param(
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot "release"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.manifest_version -ne 3 -or -not $manifest.version) {
    throw "manifest.json must be a versioned Manifest V3 extension."
}

$allowedRoots = @("manifest.json", "src", "icons")
$sourceFiles = foreach ($relativeRoot in $allowedRoots) {
    $path = Join-Path $projectRoot $relativeRoot
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required release path is missing: $relativeRoot"
    }
    Get-ChildItem -LiteralPath $path -File -Recurse
}

$forbiddenExtensions = @(".crx", ".db", ".pem", ".sqlite", ".zip")
$forbiddenNames = @("History", "Cookies", "Login Data")
foreach ($file in $sourceFiles) {
    if ($forbiddenExtensions -contains $file.Extension.ToLowerInvariant()) {
        throw "Forbidden file type in release sources: $($file.FullName)"
    }
    if ($forbiddenNames -contains $file.Name -or $file.Name -match "history-import") {
        throw "Private browser data is not allowed in the release: $($file.FullName)"
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$archiveName = "drift-ledger-v$($manifest.version).zip"
$archivePath = Join-Path $OutputDirectory $archiveName
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath
}

Push-Location $projectRoot
try {
    Compress-Archive -LiteralPath $allowedRoots -DestinationPath $archivePath -CompressionLevel Optimal
}
finally {
    Pop-Location
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($archive.Entries | ForEach-Object {
        $_.FullName.Replace([char]92, [char]47)
    })
    if ($entries -notcontains "manifest.json") {
        throw "Release archive does not contain manifest.json at its root."
    }
    $unexpected = @($entries | Where-Object {
        $_ -ne "manifest.json" -and
        -not $_.StartsWith("src/") -and
        -not $_.StartsWith("icons/")
    })
    if ($unexpected.Count -gt 0) {
        throw "Unexpected archive entries: $($unexpected -join ', ')"
    }
}
finally {
    $archive.Dispose()
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
$hashPath = "$archivePath.sha256"
"$hash  $archiveName" | Set-Content -LiteralPath $hashPath -Encoding ascii

Write-Output "Created $archivePath"
Write-Output "SHA256 $hash"
