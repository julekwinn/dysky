# Packs the release build (src-tauri\target\release\dysky.exe) into the Microsoft Store package:
#   npm run build; pwsh packaging/msix/build.ps1
# The result, dist\Dysky_<version>_x64.msix, is unsigned: the Store signs it when it is published.
# Needs the Windows SDK (makeappx and makepri), which Visual Studio's C++ tools and GitHub's Windows runners have.
param([string]$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version)
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be X.Y.Z, got '$Version'" }
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" | Sort-Object FullName | Select-Object -Last 1
if (-not $sdk) { throw 'makeappx.exe not found: install the Windows SDK' }
$bin = $sdk.DirectoryName
$exe = 'src-tauri\target\release\dysky.exe'
if (-not (Test-Path $exe)) { throw "$exe not found: run npm run build first" }

# The package layout: the app, its logos, the manifest with this version (the Store wants the 4th part 0),
# and resources.pri, which tells Windows which logo fits each size and that the unplated ones exist.
$stage = 'dist\msix'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item $stage -ItemType Directory | Out-Null
Copy-Item $exe $stage
Copy-Item packaging\msix\Assets $stage -Recurse
(Get-Content packaging\msix\AppxManifest.xml -Raw).Replace('{VERSION}', "$Version.0") | Set-Content "$stage\AppxManifest.xml" -Encoding utf8

& "$bin\makepri.exe" createconfig /cf dist\priconfig.xml /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE) { throw 'makepri createconfig failed' }
# One resources.pri with every scale: split scale files only make sense in a bundle with resource packages.
$config = [xml](Get-Content dist\priconfig.xml -Raw)
$config.resources.SelectNodes('packaging') | ForEach-Object { [void]$config.resources.RemoveChild($_) }
$config.Save((Resolve-Path dist\priconfig.xml))
& "$bin\makepri.exe" new /pr $stage /cf dist\priconfig.xml /mn "$stage\AppxManifest.xml" /of "$stage\resources.pri" /o | Out-Null
if ($LASTEXITCODE) { throw 'makepri new failed' }

$out = "dist\Dysky_${Version}_x64.msix"
& "$bin\makeappx.exe" pack /d $stage /p $out /o | Out-Null
if ($LASTEXITCODE) { throw 'makeappx pack failed' }
Write-Output "Packed $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
