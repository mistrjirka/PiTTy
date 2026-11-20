/** Explicit package identities. Never infer ownership from a name containing "pi". */
export const FOUNDERS_PACKAGES = [
  {
    id: "subagents", source: "git:github.com/mistrjirka/pi-subagent",
    names: ["@mistrjirka/pi-subagent"], files: ["index.ts"], nodeMajor: 24,
    minimumVersion: { source: "git:github.com/mistrjirka/pi-subagent", version: "0.5.26" },
    replaces: ["npm:@mistrjirka/pi-subagent", "npm:@everyx/pi-subagent", "npm:pi-subagents", "git:github.com/everyx/pi-subagent"],
  },
  {
    id: "compaction", source: "git:github.com/mistrjirka/pi-one-round-compaction",
    names: ["pi-one-round-compaction"], files: ["src/index.ts"],
    replaces: ["npm:pi-one-round-compaction", "npm:pi-smart-compact"],
  },
  {
    id: "memory", source: "git:github.com/mistrjirka/pi-eigen-memory",
    names: ["pi-hermes-memory"], files: ["src/index.ts"],
    replaces: ["npm:pi-hermes-memory", "git:github.com/chandra447/pi-hermes-memory"],
  },
  {
    id: "doppelclaude", source: "git:github.com/mistrjirka/pi-doppelclaude",
    names: ["pi-doppelclaude-workspace"],
    files: ["packages/doppelclaude/dist/index.js", "packages/pi-doppelclaude/dist/index.js",
      "packages/doppelclaude/dist/side-question.js", "packages/pi-doppelclaude/dist/pi-side-question.js",
      "packages/pi-doppelclaude/dist/activation-settings.js"],
    build: "doppelclaude",
    replaces: ["npm:pi-doppelclaude", "git:github.com/thurstonsand/pi-doppelclaude"],
  },
  {
    id: "btw", source: "git:https://github.com/mistrjirka/PiTTy-BTW.git",
    names: ["@mistrjirka/pi-btw"], files: ["index.ts"],
    replaces: ["npm:pi-btw", "git:github.com/dbachelder/pi-btw", "git:github.com/Fatih0234/btw", "git:github.com/mistrjirka/pi-btw"],
  },
  {
    id: "skills", source: "git:https://github.com/mistrjirka/PiTTy-Skills.git",
    names: ["@mistrjirka/pitty-skills"], files: ["manifest.json"],
    minimumVersion: { source: "git:https://github.com/mistrjirka/PiTTy-Skills.git", version: "0.2.0" },
    replaces: ["git:github.com/mistrjirka/pitty-skills"],
  },
  {
    id: "todo", source: "npm:@juicesharp/rpiv-todo",
    names: ["@juicesharp/rpiv-todo"], files: ["index.ts"], replaces: [],
  },
  {
    id: "web", source: "npm:pi-web-access",
    names: ["pi-web-access"], files: ["dist"], replaces: [],
  },
  {
    id: "search", source: "npm:pi-diet-semble",
    names: ["pi-diet-semble"], files: ["index.ts"], replaces: [],
  },
  {
    id: "background", source: "npm:pi-bg-bash",
    names: ["pi-bg-bash"], files: ["src/index.ts"], replaces: [],
  },
  {
    id: "code", source: "npm:pi-code-tool@0.6.2",
    names: ["pi-code-tool"], files: ["extensions/index.js", "dist/pi/extension.js"],
    version: "0.6.2", replaces: [],
  },
];

export function foundersCatalog(overrides = {}) {
  return FOUNDERS_PACKAGES.map((entry) => ({
    ...entry,
    ...(overrides[entry.id] ? { source: overrides[entry.id], replaces: [...entry.replaces, entry.source], explicitSource: true } : {}),
  }));
}
