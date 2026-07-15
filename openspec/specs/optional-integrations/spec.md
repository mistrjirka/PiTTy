# Optional integrations specification

## Detection

- PiTTy SHALL detect supported packages through `pi list`, Pi settings, and known local package roots.
- Detection failure SHALL NOT prevent PiTTy from starting.
- Missing supported packages SHALL produce one concise informational notification per startup.

## Degraded behavior

- When `pi-subagents` is absent, the subagent sidebar, inspector, and related controls SHALL be hidden.
- When `@juicesharp/rpiv-todo` is absent, the Todo panel SHALL be hidden.
- Generic tool cards SHALL continue to render any corresponding unknown tool calls.
- Historical compatible data MAY enable a panel even when package detection is inconclusive.

## Installation

- Installers SHALL offer supported packages as an optional step.
- A failed optional-package install SHALL report package, command, exit code, and log path.
- Core PiTTy installation SHALL remain usable after an optional-package failure.
