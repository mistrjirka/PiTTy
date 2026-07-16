# Installer specification

## Platforms

- POSIX installer: Linux, macOS, and WSL through `install.sh`.
- PowerShell installer: native Windows through `install.ps1`.
- Both SHALL support interactive and noninteractive operation.

## Inputs

- Repository, version, installation directory, and binary directory SHALL be configurable.
- Installers SHALL support explicit `--with-plugins` / `--without-plugins` or PowerShell equivalents.
- Installers SHALL verify release checksums when available.

## Windows command path

- The PowerShell installer SHALL add the configured binary directory to the current user's `PATH` without duplicating an equivalent entry.
- The PowerShell uninstaller SHALL remove only `PATH` entries equivalent to the configured binary directory and SHALL preserve unrelated entries.

## Diagnostics

- Missing prerequisites SHALL identify the missing command.
- Download failures SHALL identify the requested release asset URL.
- Dependency and runtime installation failures SHALL show the exact command and retained log path.
- Optional integration failures SHALL be distinguishable from fatal core installation failures.

## Release format

- Tagged releases SHALL contain `pitty-<version>.tar.gz`, `pitty-<version>.zip`, and `SHA256SUMS`.
- Release archives SHALL contain source, package lock, launch wrapper, docs, and installers, but SHALL exclude `node_modules` and private diagnostics.
