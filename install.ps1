param(
  [string]$Target = "$HOME\.gemini\config\skills"
)

$ErrorActionPreference = "Stop"
$srcRoot = Join-Path $PSScriptRoot "skills"
New-Item -ItemType Directory -Force -Path $Target | Out-Null

Get-ChildItem $srcRoot -Directory | ForEach-Object {
  $dst = Join-Path $Target $_.Name
  Write-Host "Installing $($_.Name) -> $dst"
  robocopy $_.FullName $dst /E /XD .git node_modules /NFL /NDL /NJH /NJS /NC /NS | Out-Null
}
Write-Host "Done! All skills synced to $Target"
