[CmdletBinding(DefaultParameterSetName='Store')]
param(
    [Parameter(Mandatory, ParameterSetName='Test')][switch]$TestBuild,
    [Parameter(Mandatory, ParameterSetName='Store')][ValidateNotNullOrEmpty()][string]$IdentityName,
    [Parameter(Mandatory, ParameterSetName='Store')][ValidateNotNullOrEmpty()][string]$Publisher,
    [Parameter(Mandatory, ParameterSetName='Store')][ValidateNotNullOrEmpty()][string]$PublisherDisplayName
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
$dist = Join-Path $root 'dist'
$version = [version](Get-Content "$root/package.json" -Raw | ConvertFrom-Json).version
$stage = Join-Path ([IO.Path]::GetTempPath()) ("unsocial-msix-" + [guid]::NewGuid().ToString('N'))
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$tools = Get-ChildItem -LiteralPath $sdk -Directory | Where-Object {
    $_.Name -as [version] -and (Test-Path (Join-Path $_.FullName 'x64/makeappx.exe'))
} | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$tools) { throw 'MSIX packaging requires the Windows 10 or 11 SDK with MakeAppx.exe.' }
$makeAppx = Join-Path $tools.FullName 'x64/makeappx.exe'
$archive = Join-Path $dist "Unsocial-Network-$version-Windows-x64.zip"
$manifest = [xml](Get-Content "$PSScriptRoot/AppxManifest.xml" -Raw)
$id = $manifest.Package.Identity
if (!$TestBuild) {
    if ($IdentityName -eq $id.Name -or $Publisher -eq $id.Publisher) { throw 'Supply the product identity from Partner Center.' }
    $id.SetAttribute('Name', $IdentityName)
    $id.SetAttribute('Publisher', $Publisher)
    $manifest.Package.Properties.PublisherDisplayName = $PublisherDisplayName
}
# Store reserves the fourth field and requires a positive major version.
$id.SetAttribute('Version', ('{0}.{1}.{2}.0' -f ($version.Major + 1), $version.Minor, $version.Build))
$label = if ($TestBuild) { 'Test' } else { 'Store' }
$output = Join-Path $dist "Unsocial-Network-$version-Windows-x64-$label.msix"
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    Copy-Item -LiteralPath "$PSScriptRoot/Assets" -Destination $stage -Recurse
    $manifest.Save((Join-Path $stage 'AppxManifest.xml'))
    & $makeAppx pack /d $stage /p "$stage.msix" /o
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx rejected the package.' }
    Move-Item -LiteralPath "$stage.msix" -Destination $output -Force
    Write-Host "Built $output"
} finally {
    $resolved = (Resolve-Path -LiteralPath $stage).Path
    if ($resolved -eq $stage -and (Split-Path $resolved -Leaf) -match '^unsocial-msix-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
        if (Test-Path -LiteralPath "$resolved.msix") { Remove-Item -LiteralPath "$resolved.msix" -Force }
    }
}
