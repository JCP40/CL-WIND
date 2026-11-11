# CL-WIND : construit dist/CL-WIND-kit.zip (application, lanceur, LISEZMOI, exemples)
#   powershell -ExecutionPolicy Bypass -File scripts\build_kit.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'CL-WIND'
$zip = Join-Path $dist 'CL-WIND-kit.zip'

# exemples : regénérés si Node.js est disponible, sinon ceux du dépôt
$ex = Join-Path $root 'exemples'
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path (Join-Path $root 'scripts') 'make_examples.js') | Out-Host
} elseif (-not (Test-Path $ex)) {
  throw "Dossier exemples absent et Node.js introuvable : lancez scripts/make_examples.js ailleurs."
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

foreach ($item in @('index.html', 'css', 'js', 'meteo', 'exemples', 'grasshopper', 'LANCER-CL-WIND.bat', 'LISEZMOI.txt')) {
  $src = Join-Path $root $item
  if (-not (Test-Path $src)) { throw "Fichier manquant : $item" }
  Copy-Item $src -Destination $stage -Recurse
}

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Kit cree : $zip ($size Mo)"
