# Founder setup

`pitty founders-setup` installs the maintained plugin set and the public skills
and agents package. It is an explicit setup command. Ordinary PiTTy startup does
not change the user's Pi package list.

## Run

```sh
pitty founders-setup --dry-run
pitty founders-setup
pitty founders-setup --check
```

First installation can run the same setup with `install.sh --founders-setup`
or `install.ps1 -FoundersSetup`. Founder setup currently requires the managed
runtime supported on Linux, macOS and WSL, with Node.js 24 or newer. If the existing
Pi installation is older, setup downloads the exact supported base into an isolated
temporary prefix and builds the managed runtime from it. Global Pi stays unchanged.
An explicitly selected upstream runtime is respected. Normal PiTTy installation
remains available on Windows.

[PiTTy-Skills](https://github.com/mistrjirka/PiTTy-Skills) and
[PiTTy-BTW](https://github.com/mistrjirka/PiTTy-BTW) are public MIT-licensed
repositories. Setup uses public HTTPS sources. Installing them requires no wiki
access, GitHub account or SSH key.

## Installed packages

| Source | Purpose |
| --- | --- |
| `mistrjirka/pi-subagent` | Profile-based child agents |
| `mistrjirka/pi-one-round-compaction` | Parallel one-round compaction |
| `mistrjirka/pi-eigen-memory` | Maintained memory fork, whose package name remains `pi-hermes-memory` |
| `mistrjirka/pi-doppelclaude` | Claude Agent SDK provider |
| `mistrjirka/PiTTy-BTW` | Temporary side questions |
| `mistrjirka/PiTTy-Skills` | Selected skills, agents and required references |
| `@juicesharp/rpiv-todo` | Todo tools and panel |
| `pi-web-access` | Web tools |
| `pi-diet-semble` | Semantic code search |
| `pi-bg-bash` | Background commands |
| `pi-code-tool@0.6.2` | Verified base for the managed code-tool fork |

The setup matches exact package identities before adding entries. It replaces
known competing subagent, compaction and BTW packages with the maintained versions.
It preserves explicit pins and resource filters on existing selected packages,
plus unrelated packages and user settings. Downloads, builds and managed-runtime
checks finish before the package settings and agent profiles are activated.

DoppelClaude is built before activation. Installing its package does not sign in
to Claude Code or create the user's provider prompt configuration. Existing
provider configuration remains in place. When no `doppelclaude` settings section
exists, DoppelClaude stays inactive and displays a setup notice. Configure it and reload Pi
to make its models available.

## Where skills and agents live

The public repository keeps ordinary `skills/` and `agents/` directories at its
root. Pi's package manifest selects only `skills/` for skill discovery.

| Use | Location |
| --- | --- |
| Installed package skills | The package's `skills/` directory in Pi's managed Git checkout under `~/.pi/agent/git/` |
| Installed Pi subagents | `~/.pi/agent/agents/*.md` |
| Personal Pi-only skills | `~/.pi/agent/skills/` |
| Project Pi skills and agent overrides | `.pi/skills/` and `.pi/agents/` |
| Shared Agent Skills locations | `~/.agents/skills/` and project `.agents/skills/` |

The default Pi directory is `~/.pi/agent`. `PI_CODING_AGENT_DIR` or
`--agent-dir` can select a different Pi directory. `~/.config/pi` is not a default
discovery location, so setup does not move existing configuration there. When using
`--agent-dir`, also set `PI_CODING_AGENT_DIR` to that directory when running PiTTy
or Pi.

Use package installation for the complete bundle. To share only its skills with
another compatible tool, link the checkout's `skills/` directory into that tool's
supported location. Keep the editable checkout outside automatically scanned skill
directories. Shared skill discovery can otherwise load agent Markdown as skills.
Do not register both the package and a second link to the same skills.

Founder setup manages only its own agent copies and records ownership. It reports
and preserves existing custom files with the same name. Project profiles override
global profiles by exact name.

Exported agent frontmatter has no model pin. The active parent model is inherited
unless the user has an existing profile override. Founder setup preserves those
user overrides and never selects a default model.

## Fork or edit the package

Anyone can fork the public repository and select their fork:

```sh
pitty founders-setup --skills-source git:https://github.com/YOUR_NAME/PiTTy-Skills.git
```

For local development, point setup at an editable checkout:

```sh
pitty founders-setup --skills-source /absolute/path/to/PiTTy-Skills
```

Setup remembers the selected source. Later runs keep using it. An explicit new
source replaces the previously selected package without adding a duplicate.
The same behavior applies to `--btw-source`.

Setup refreshes an unpinned maintained skills package older than `0.2.0` and an
unpinned maintained subagent package older than `0.5.26`. This applies the revised
seven-skill selection and enables new user input to wake an active `agent_wait`.
Explicit refs, custom forks and editable local sources keep their own versions.
Before automatic refresh, setup checks for edits or unpublished commits inside the
maintained Git cache. It stops without discarding them. Keep such changes in an
editable checkout or fork before updating. Pi-created dependency files can be rebuilt.

Setup otherwise reuses prepared Git checkouts. To fetch changes from a selected
fork, update that package before refreshing its managed agent copies:

```sh
pi update git:https://github.com/YOUR_NAME/PiTTy-Skills.git
pitty founders-setup
```

Use the configured source and ref in the update command. A pinned tag or commit
stays pinned until you explicitly select another source or ref.

Pi reads skills directly from the selected package. After editing agent profiles,
run `npm run manifest` in that checkout, then run founder setup again to refresh its
managed agent copies. Custom agent files remain untouched. Reload Pi
to refresh skills in an existing process.

To return to the maintained package, explicitly select its source:

```sh
pitty founders-setup --skills-source git:https://github.com/mistrjirka/PiTTy-Skills.git
```

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
