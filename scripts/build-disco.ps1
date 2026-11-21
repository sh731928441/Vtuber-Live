$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $sourceDir "disco-src"
Push-Location $frontendDir
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Disco 前端构建失败，退出码 $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host "Disco build OK: $sourceDir\web\disco"
