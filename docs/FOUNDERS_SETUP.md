# Founder setup

`pitty founders-setup` installs the maintained plugin set and the user's selected
skills and agents. It is an explicit setup command. Ordinary PiTTy startup does
not change the user's Pi package list.

## Run

```sh
pitty founders-setup --dry-run
pitty founders-setup
pitty founders-setup --check
```

First installation can run the same setup with `install.sh --founders-setup`
or `install.ps1 -FoundersSetup`. Founder setup currently requires the managed
runtime supported on Linux, macOS and WSL, with Node.js 24 or newer and the verified
Pi version. Normal PiTTy installation remains available on Windows.

The skills repository is private. The account running setup needs GitHub access
through its normal Git configuration. Setup never copies credentials from the wiki.

## Installed packages

| Source | Purpose |
| --- | --- |
| `mistrjirka/pi-subagent` | Profile-based child agents |
| `mistrjirka/pi-one-round-compaction` | Parallel one-round compaction |
| `mistrjirka/pi-eigen-memory` | Maintained memory fork, whose package name remains `pi-hermes-memory` |
| `mistrjirka/pi-doppelclaude` | Claude Agent SDK provider |
| `mistrjirka/pi-btw` | Temporary side questions |
| `mistrjirka/pitty-skills` | Selected skills, agents and required references |
| `@juicesharp/rpiv-todo` | Todo tools and panel |
| `pi-web-access` | Web tools |
| `pi-diet-semble` | Semantic code search |
| `pi-bg-bash` | Background commands |
| `pi-code-tool@0.6.2` | Verified base for the managed code-tool fork |

The setup matches exact package identities before adding entries. It replaces
known competing subagent, compaction and BTW packages with the maintained versions.
It preserves explicit pins and resource filters on existing owned packages, plus
unrelated packages and user settings. Downloads, builds and managed-runtime checks
finish before the package settings and agent profiles are activated.

DoppelClaude is built before activation. Installing its package does not sign in
to Claude Code or create the user's provider prompt configuration. Existing
provider configuration remains in place.

## Skills and agents

The separate repository contains skills the user authored or substantively
customized, selected from the current Pi wiki branch. Its inventory records
included and excluded items with provenance. Imported skills without demonstrated
customization are excluded.

Pi loads skills from the installed package. The subagent extension reads individual
agent files in the configured Pi agent directory. Founder setup manages only its
own agent files and records ownership. Existing custom files with the same name
are reported and preserved.

Exported agent frontmatter has no model pin. The active parent model is inherited
unless the user has an existing profile override. Founder setup preserves those
user overrides and never selects a default model.

## Side questions

```text
/btw Why does this retry?
/btw cancel
/btw clear
/btw show
```

The question runs independently and appears above the editor. The command returns
immediately. A new question replaces the previous side question. `cancel` stops
only that question. `clear` hides the widget and `show`, or `/btw` alone, reopens
the latest result. The result is kept in memory and is not appended to the main
conversation.

Each question uses fresh safe context. Incomplete tool-call groups are excluded.
API providers retain the main prompt, tool declarations and cache identity where
safe, append the question, and make one request without executing tools. Unsafe
snapshots and unsupported providers produce an error instead of an ordinary
agent turn.

DoppelClaude uses its existing query's separate side-question control request.
It needs a live query for the same conversation and model. A newly opened or
rebuilt conversation needs one main message first.

Cache reuse depends on the provider and effective request. No live cache savings
or latency has been measured. The native Claude control reply contains no usage
figures, so the widget does not display invented token or cost numbers.

## Existing conversations

No session-file migration is required. Skills and agents affect future work.
Temporary widgets and side questions do not rewrite past messages. Start a new
PiTTy process after installing a changed managed runtime.
