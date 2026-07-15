# PiTTy project context

## Purpose

PiTTy is an independent OpenTUI frontend for the Pi coding agent. It launches Pi in RPC mode and provides a faster, more inspectable terminal interface while preserving Pi's authentication, models, sessions, tools, skills, prompt templates, and extensions.

## Product principles

- Pi remains the source of truth for sessions and agent execution.
- Standard Pi RPC messages, tools, commands, and extension dialogs must work without plugin-specific code.
- Optional integrations may enrich the UI but must never be required for startup.
- Missing integrations are reported once, then their panels and controls remain hidden.
- Long sessions must remain responsive through bounded rendering and lazy history loading.
- Errors must include the failed command, exit code, and a log path whenever possible.
- Linux, macOS, Windows, and WSL are considered in public interfaces and installation design.

## Current optional integrations

- `npm:pi-subagents`: live child-agent state, transcript inspection, pause/stop, and steering.
- `npm:@juicesharp/rpiv-todo`: bounded active/completed Todo panel.

## Technology

- TypeScript and Solid
- OpenTUI
- Bun runtime installed as a project dependency
- Pi JSONL RPC subprocess

## Repository conventions

- Specs live in `openspec/specs/<capability>/spec.md`.
- Proposed work lives in `openspec/changes/<change-name>/` with `proposal.md`, `design.md`, and `tasks.md` where applicable.
- The generic RPC renderer is the fallback; specialized integration behavior belongs behind explicit adapters or detection boundaries.
