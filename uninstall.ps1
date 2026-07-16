param(
  [string]$InstallDir = $(if ($env:PITTY_INSTALL_DIR) { $env:PITTY_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "PiTTy\app" }),
  [string]$BinDir = $(if ($env:PITTY_BIN_DIR) { $env:PITTY_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "PiTTy\bin" })
)
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $BinDir "pitty.cmd"), (Join-Path $BinDir "pitty-resume.cmd")
Write-Host "Removed PiTTy. Optional Pi packages were left installed."
