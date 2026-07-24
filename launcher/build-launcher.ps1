$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherProject = Join-Path $PSScriptRoot "MaterialMakerLauncher.csproj"
$publishDirectory = Join-Path $PSScriptRoot "bin\publish"
$outputPath = Join-Path $projectRoot "Material Maker.exe"

dotnet publish $launcherProject `
    --configuration Release `
    --runtime win-x64 `
    --self-contained false `
    --output $publishDirectory

Copy-Item `
    -LiteralPath (Join-Path $publishDirectory "Material Maker.exe") `
    -Destination $outputPath `
    -Force

Write-Host "Built $outputPath"
