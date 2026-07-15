[CmdletBinding()]
param(
  [switch]$WithPlugins,
  [switch]$WithoutPlugins,
  [switch]$Yes,
  [switch]$AllowPluginFailure,
  [string]$Version = $env:PITTY_VERSION,
  [string]$InstallDir = $env:PITTY_INSTALL_DIR,
  [string]$BinDir = $env:PITTY_BIN_DIR,
  [string]$Repo = $(if ($env:PITTY_REPO) { $env:PITTY_REPO } else { "mistrjirka/PiTTy" })
)
$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = "latest" }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA "PiTTy\app" }
if (-not $BinDir) { $BinDir = Join-Path $env:LOCALAPPDATA "PiTTy\bin" }

function Fail([string]$Message) { Write-Error $Message; exit 1 }
function Need([string]$Command) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Fail "Required command '$Command' was not found. Install it, open a new terminal, and re-run this installer."
  }
}
Need node; Need npm; Need pi
$NodeVersion = [version]((& node -p "process.versions.node").Trim())
if ($NodeVersion -lt [version]"22.19.0") { Fail "Node.js 22.19.0 or newer is required; found $NodeVersion." }

$Temp = Join-Path ([IO.Path]::GetTempPath()) ("pitty-install-" + [guid]::NewGuid())
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Logs = Join-Path $env:LOCALAPPDATA "PiTTy\logs\install-$Stamp"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
try {
  if ($Version -eq "latest") {
    Write-Host "Resolving the latest PiTTy release from $Repo..."
    try { $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "PiTTy-Installer" } }
    catch { Fail "Could not read the latest GitHub release for $Repo. The repository may not have a release yet. $($_.Exception.Message)" }
    $Tag = $Release.tag_name
    if (-not $Tag) { Fail "GitHub returned a release without tag_name." }
  } else { $Tag = $(if ($Version.StartsWith("v")) { $Version } else { "v$Version" }) }
  $Ver = $Tag.TrimStart("v")
  $Asset = "pitty-$Ver.zip"
  $Url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
  $Archive = Join-Path $Temp $Asset
  Write-Host "Downloading PiTTy $Ver..."
  try { Invoke-WebRequest -Uri $Url -OutFile $Archive -UseBasicParsing }
  catch { Fail "Download failed: $Url`n$($_.Exception.Message)" }

  try {
    $Checksums = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS" -UseBasicParsing
    $ExpectedLine = ($Checksums.Content -split "`n" | Where-Object { $_ -match [regex]::Escape($Asset) } | Select-Object -First 1)
    if ($ExpectedLine) {
      $Expected = ($ExpectedLine -split "\s+")[0].ToLowerInvariant()
      $Actual = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant()
      if ($Expected -ne $Actual) { Fail "Checksum mismatch for $Asset (expected $Expected, got $Actual)" }
    }
  } catch { Write-Warning "Release checksum could not be verified: $($_.Exception.Message)" }

  $Source = Join-Path $Temp "source"
  Expand-Archive -Path $Archive -DestinationPath $Source -Force
  $Root = Get-ChildItem -Path $Source -Directory | Select-Object -First 1
  if (-not $Root) { Fail "Release archive had no top-level directory." }
  $NewDir = "$InstallDir.new"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $NewDir
  New-Item -ItemType Directory -Force -Path $NewDir | Out-Null
  Copy-Item -Recurse -Force (Join-Path $Root.FullName "*") $NewDir

  $NpmLog = Join-Path $Logs "npm-install.log"
  Push-Location $NewDir
  try {
    & npm ci --ignore-scripts --no-audit --no-fund *> $NpmLog
    if ($LASTEXITCODE -ne 0) { Fail "npm dependency installation failed.`n  command: npm ci --ignore-scripts --no-audit --no-fund`n  log: $NpmLog`n$((Get-Content $NpmLog -Tail 30) -join "`n")" }
    $BunLog = Join-Path $Logs "bun-install.log"
    & node node_modules/bun/install.js *> $BunLog
    if ($LASTEXITCODE -ne 0) { Fail "Bun runtime installation failed.`n  command: node node_modules/bun/install.js`n  log: $BunLog`n$((Get-Content $BunLog -Tail 30) -join "`n")" }
  } finally { Pop-Location }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  Move-Item $NewDir $InstallDir
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Cmd = Join-Path $BinDir "pitty.cmd"
  "@echo off`r`nnode `"$InstallDir\bin\pitty.mjs`" %*`r`n" | Set-Content -Encoding ASCII $Cmd

  $PluginMode = if ($WithPlugins) { "yes" } elseif ($WithoutPlugins) { "no" } elseif ($Yes) { "yes" } else { "ask" }
  if ($PluginMode -eq "ask") {
    $Answer = Read-Host "Install recommended Pi packages (pi-subagents and rpiv-todo)? [Y/n]"
    $PluginMode = if ($Answer -match '^(n|no)$') { "no" } else { "yes" }
  }
  $Failures = 0
  function Install-Plugin([string]$Spec, [string]$Needle) {
    $Current = (& pi list 2>$null | Out-String)
    if ($Current.Contains($Needle)) { Write-Host "Optional Pi package already installed: $Spec"; return }
    $Safe = $Needle.Replace("@", "_").Replace("/", "_")
    $Log = Join-Path $Logs "plugin-$Safe.log"
    Write-Host "Installing optional Pi package: $Spec"
    & pi install $Spec *> $Log
    if ($LASTEXITCODE -ne 0) {
      $script:Failures++
      Write-Error "Optional Pi package installation failed.`n  package: $Spec`n  command: pi install $Spec`n  exit code: $LASTEXITCODE`n  log: $Log`n$((Get-Content $Log -Tail 30) -join "`n")`nPiTTy itself is installed and will run without this integration." -ErrorAction Continue
    }
  }
  if ($PluginMode -eq "yes") {
    Install-Plugin "npm:pi-subagents" "pi-subagents"
    Install-Plugin "npm:@juicesharp/rpiv-todo" "@juicesharp/rpiv-todo"
  } else { Write-Host "Skipping optional Pi packages. Their panels will remain hidden." }

  Write-Host ""
  Write-Host "PiTTy $Ver installed."
  Write-Host "Installer logs: $Logs"
  Write-Host "Run: $Cmd -C C:\path\to\project --continue"
  if (-not (($env:PATH -split ';') -contains $BinDir)) { Write-Warning "$BinDir is not on PATH. Add it to your user PATH or run $Cmd directly." }
  if ($Failures -gt 0 -and -not $AllowPluginFailure) { exit 2 }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temp
}
