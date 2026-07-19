# PiTTy Usability and Settings Stack

## Outcome

Deliver reliable process-local input continuity, accurate historical subagent presentation, denser conversation layout, and a reusable Settings hub with themes and MCP management. Pi remains authoritative for agent execution, sessions, models, and thinking effort; PiTTy owns only UI drafts, presentation preferences, theme configuration, and explicit MCP adapter configuration writes.

## Delivery order

1. `pitty-usability-settings-1`
2. `pitty-usability-settings-2`
3. `pitty-usability-settings-3`
4. `pitty-usability-settings-4`
5. `pitty-usability-settings-5`
6. `pitty-usability-settings-6`

Each change must be apply-ready, implemented, validated, and reviewed before the next begins. The order deliberately serializes work in `src/app.tsx` and shared UI surfaces.

## Slice contracts

### 1. pitty-usability-settings-1

Owns process-local main/per-target drafts and PiTTy-local Alt+Enter batching. It provides App-owned state plus one settled-boundary batch dispatcher to slice 6. It must not persist prompt text or alter Pi-owned steering/follow-up queues.

### 2. pitty-usability-settings-2

Owns reconstruction of historical subagent identity, metadata, and transcript references from persisted assistant tool calls and surviving artifacts. It must not synthesize inspectable children without authoritative evidence.

### 3. pitty-usability-settings-3

Owns sidebar height allocation, compact inactive subagent rows, explicit subagent action hints, and consistent assistant/thinking spacing. Slice 2 first ensures reconstructed targets carry authoritative labels and metadata; this slice presents that contract without redefining target identity.

### 4. pitty-usability-settings-4

Owns the Ctrl+X and `/settings` shell, provides the ordered `SettingsSectionDescriptor` contract consumed by slices 5 and 6, and reuses existing model, thinking-effort, and session controls. Pi RPC remains the source of truth for those values.

### 5. pitty-usability-settings-5

Consumes slice 4's section descriptor/route contract and owns ten named presets, reactive semantic colors, a full color editor, and validated user-global PiTTy configuration. It must not write theme data into Pi settings.

### 6. pitty-usability-settings-6

Consumes slice 1's App-owned input/settlement contract and slice 4's section descriptor/route contract. It owns optional `pi-mcp-adapter` installation, project/global adapter config management, atomic writes, and controlled same-session RPC restart. Restart and local queue dispatch are sequenced by one App settlement coordinator. It must not invoke the adapter's custom `/mcp` or `/mcp setup` panels over RPC.

## External gate

The alternate-screen resize/full-repaint defect is not part of this stack. Keep exact matching OpenTUI Core/Solid versions until a published pair has a `gitHead` that verifiably includes the upstream fix and passes supported-platform fresh-install and upgrade validation.

## Release sequencing

The already-validated conversation/subagent/sidebar regression patch may ship independently before this stack. Do not mix the external OpenTUI upgrade into a usability slice.
