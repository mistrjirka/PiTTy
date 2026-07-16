[CmdletBinding()]
param(
  [switch]$WithPlugins,
  [switch]$WithoutPlugins,
  [switch]$Yes,
  [switch]$AllowPluginFailure,
  [switch]$DeferApply,
  [string]$Version = $env:PITTY_VERSION,
  [string]$InstallDir = $env:PITTY_INSTALL_DIR,
  [string]$BinDir = $env:PITTY_BIN_DIR,
  [string]$Repo = $(if ($env:PITTY_REPO) { $env:PITTY_REPO } else { "mistrjirka/PiTTy" })
)
$ErrorActionPreference = "Stop"
if (-not $Version) { $Version = "latest" }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA "PiTTy\app" }
if (-not $BinDir) { $BinDir = Join-Path $env:LOCALAPPDATA "PiTTy\bin" }

function Fail([string]$Message) { throw $Message }
function Need([string]$Command) { if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { Fail "Required command '$Command' was not found. Install it, open a new terminal, and re-run this installer." } }
Need node; Need npm; Need pi
$NodeVersion = [version]((& node -p "process.versions.node").Trim())
if ($NodeVersion -lt [version]"22.19.0") { Fail "Node.js 22.19.0 or newer is required; found $NodeVersion." }

$Temp = Join-Path ([IO.Path]::GetTempPath()) ("pitty-install-" + [guid]::NewGuid())
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogRoot = if ($env:PITTY_LOG_DIR) { $env:PITTY_LOG_DIR } else { Join-Path $env:LOCALAPPDATA "PiTTy\logs\install-$Stamp" }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
try {
  New-Item -ItemType Directory -Force -Path $Temp | Out-Null
  if ($Version -eq "latest") {
    Write-Host "Resolving the latest PiTTy release from $Repo..."
    try { $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "PiTTy-Installer" } } catch { Fail "Could not read the latest GitHub release for $Repo. $($_.Exception.Message)" }
    $Tag = $Release.tag_name
    if (-not $Tag) { Fail "GitHub returned a release without tag_name." }
  } else { $Tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" } }
  $Ver = $Tag.TrimStart("v"); $Asset = "pitty-$Ver.zip"; $Url = "https://github.com/$Repo/releases/download/$Tag/$Asset"; $Archive = Join-Path $Temp $Asset
  Write-Host "Downloading PiTTy $Ver..."
  try { Invoke-WebRequest -Uri $Url -OutFile $Archive -UseBasicParsing } catch { Fail "Download failed: $Url`n$($_.Exception.Message)" }
  try { $Checksums = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS" -UseBasicParsing } catch { Fail "Release checksum could not be downloaded; refusing to install without verification. $($_.Exception.Message)" }
  $ExpectedLine = ($Checksums.Content -split "`n" | Where-Object { $_ -match [regex]::Escape($Asset) } | Select-Object -First 1)
  if (-not $ExpectedLine) { Fail "SHA256SUMS did not contain $Asset" }
  $Expected = ($ExpectedLine -split "\s+")[0].ToLowerInvariant(); $Actual = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant(); if ($Expected -ne $Actual) { Fail "Checksum mismatch for $Asset (expected $Expected, got $Actual)" }

  $Source = Join-Path $Temp "source"; Expand-Archive -Path $Archive -DestinationPath $Source -Force
  $Root = Get-ChildItem -Path $Source -Directory | Select-Object -First 1
  if (-not $Root) { Fail "Release archive had no top-level directory." }
  $NewDir = "$InstallDir.new"; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $NewDir; New-Item -ItemType Directory -Force -Path $NewDir | Out-Null
  Copy-Item -Recurse -Force (Join-Path $Root.FullName "*") $NewDir
  $NpmLog = Join-Path $LogRoot "npm-install.log"; Push-Location $NewDir
  try { & npm ci --ignore-scripts --no-audit --no-fund *> $NpmLog; if ($LASTEXITCODE -ne 0) { Fail "npm dependency installation failed. See $NpmLog" }; $BunLog = Join-Path $LogRoot "bun-install.log"; & node node_modules/bun/install.js *> $BunLog; if ($LASTEXITCODE -ne 0) { Fail "Bun runtime installation failed. See $BunLog" } } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $NewDir "bin\pitty.mjs"))) { Fail "archive is missing bin/pitty.mjs" }
  if (-not (Test-Path (Join-Path $NewDir "package.json"))) { Fail "archive is missing package.json" }
  if (-not (Test-Path (Join-Path $NewDir "node_modules\.bin\bun.exe")) -and -not (Test-Path (Join-Path $NewDir "node_modules\.bin\bun"))) { Fail "staged dependencies are missing bundled Bun" }
  $PluginMode = if ($WithPlugins) { "yes" } elseif ($WithoutPlugins) { "no" } elseif ($env:PITTY_PLUGIN_MODE -in @("yes", "no")) { $env:PITTY_PLUGIN_MODE } else { "ask" }
  $Metadata = [ordered]@{ schemaVersion = 1; repository = $Repo; installedVersion = $Ver; installDirectory = $InstallDir; binDirectory = $BinDir; pluginMode = $PluginMode }
  $MetadataJson = $Metadata | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $NewDir "pitty-install.json"), "$MetadataJson`n", (New-Object Text.UTF8Encoding($false)))
  $SmokeLog = Join-Path $LogRoot "smoke.log"
  & node (Join-Path $NewDir "bin\pitty.mjs") --help *> $SmokeLog
  if ($LASTEXITCODE -ne 0) { Fail "staged smoke validation failed. See $SmokeLog" }

  if ($DeferApply) {
    $Pending = "$InstallDir.pending"; if (Test-Path $Pending) { Fail "another upgrade is already staged at $Pending" }; New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null; Move-Item $NewDir $Pending
    Write-Host "PiTTy $Ver validated and staged at $Pending; it will activate on next launch."; return
  }
  $Backup = "$InstallDir.backup"
  if (Test-Path $Backup) { Fail "cannot install because a previous backup already exists at $Backup; remove it after inspection and retry." }
  $MovedBackup = $false
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
    if (Test-Path $InstallDir) { Move-Item $InstallDir $Backup; $MovedBackup = $true }
    Move-Item $NewDir $InstallDir
    & node (Join-Path $InstallDir "bin\pitty.mjs") --help *> $SmokeLog
    if ($LASTEXITCODE -ne 0) { Fail "installation smoke validation failed. See $SmokeLog" }
    if ($MovedBackup) { Remove-Item -Recurse -Force $Backup }
  } catch {
    if ($MovedBackup) {
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
      if (Test-Path $Backup) { Move-Item $Backup $InstallDir }
    } else { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $NewDir }
    Fail "installation failed; previous installation was restored. See $LogRoot. $($_.Exception.Message)"
  }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  "@echo off`r`nnode `"$InstallDir\bin\pitty.mjs`" %*`r`n" | Set-Content -Encoding ASCII (Join-Path $BinDir "pitty.cmd")
  "@echo off`r`nnode `"$InstallDir\bin\pitty-resume.mjs`" %*`r`n" | Set-Content -Encoding ASCII (Join-Path $BinDir "pitty-resume.cmd")

  $PiList = if ($PluginMode -eq "ask" -or $PluginMode -eq "yes") { (& pi list 2>$null | Out-String) } else { "" }
  $Missing = @(); if (-not $PiList.Contains("pi-subagents")) { $Missing += "pi-subagents" }; if (-not $PiList.Contains("@juicesharp/rpiv-todo")) { $Missing += "@juicesharp/rpiv-todo" }
  if ($PluginMode -eq "ask" -and $Missing.Count -eq 0) { Write-Host "Recommended Pi packages are already installed; skipping plugin prompt."; $PluginMode = "no" }
  elseif ($PluginMode -eq "ask") { $PluginMode = if ($Yes) { "yes" } elseif ((Read-Host "Install missing recommended Pi packages ($($Missing -join ', '))? [Y/n]") -match '^(n|no)$') { "no" } else { "yes" } }
  $Failures = 0
  foreach ($Plugin in @(@("npm:pi-subagents", "pi-subagents"), @("npm:@juicesharp/rpiv-todo", "@juicesharp/rpiv-todo"))) { if ($PluginMode -eq "yes" -and -not $PiList.Contains($Plugin[1])) { $Log = Join-Path $LogRoot ("plugin-" + $Plugin[1].Replace("@", "_").Replace("/", "_") + ".log"); & pi install $Plugin[0] *> $Log; if ($LASTEXITCODE -ne 0) { $Failures++; Write-Warning "Optional Pi package $($Plugin[0]) failed (exit code: $LASTEXITCODE); log: $Log" } } }
  Write-Host "PiTTy $Ver installed. Installer logs: $LogRoot"
  if ($Failures -gt 0 -and -not $AllowPluginFailure) { exit 2 }
} catch { Write-Error $_.Exception.Message; exit 1 } finally { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temp }
