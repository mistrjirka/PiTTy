param(
  [string]$InstallDir = $(if ($env:PITTY_INSTALL_DIR) { $env:PITTY_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "PiTTy\app" }),
  [string]$BinDir = $(if ($env:PITTY_BIN_DIR) { $env:PITTY_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "PiTTy\bin" })
)
# Keep this normalization identical to install.ps1.
function Normalize-PathEntry([string]$Entry) {
  if (-not $Entry) { return "" }
  $trimmed = $Entry.Trim().Trim('"').Trim("'")
  $expanded = [Environment]::ExpandEnvironmentVariables($trimmed)
  try { return [IO.Path]::GetFullPath($expanded).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) } catch { return $expanded.Trim() }
}
$normalized = Normalize-PathEntry $BinDir
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$remaining = @($userPath -split ";" | Where-Object { $_ -and (Normalize-PathEntry $_) -ine $normalized })
[Environment]::SetEnvironmentVariable("Path", ($remaining -join ";"), "User")
$processEntries = @($env:Path -split ";" | Where-Object { $_ -and (Normalize-PathEntry $_) -ine $normalized })
$env:Path = $processEntries -join ";"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $BinDir "pitty.cmd"), (Join-Path $BinDir "pitty-resume.cmd")
Write-Host "Removed PiTTy. Optional Pi packages were left installed."
