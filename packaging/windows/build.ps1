$ErrorActionPreference = 'Stop'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (!$compiler) {
    $compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
}
if (!(Test-Path -LiteralPath $compiler)) { throw 'Install Inno Setup 6.3 or newer and put ISCC.exe on PATH.' }
$stage = Join-Path (Resolve-Path build) ("win-setup-" + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath "dist/Unsocial-Network-$version-Windows-x64.zip" -DestinationPath $stage
$payload = Join-Path $stage 'Unsocial Network'
$dist = (Resolve-Path dist).Path
& $compiler "/DAppVersion=$version" "/DPayloadPath=$payload" "/DOutputPath=$dist" 'packaging/windows/desktop.iss'
if ($LASTEXITCODE -ne 0) { throw 'Windows installer compilation failed.' }
