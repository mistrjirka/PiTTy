import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { installAgents, planAgents } from "../scripts/founders-state.mjs";

const bundle = process.env.PITTY_TEST_CURATED_BUNDLE;
const registry = process.env.PITTY_TEST_SUBAGENT_PROFILES;

test.skipIf(!bundle || !registry)("curated agent copies load through the actual subagent registry with no model pins", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-founders-registry-"));
  const agentDir = path.join(base, "agent");
  const cwd = path.join(base, "project");
  try {
    fs.mkdirSync(cwd, { recursive: true });
    const plan = planAgents(bundle!, agentDir);
    installAgents(plan);
    const names = plan.agents.map((agent) => agent.name);
    const child = [
      "const { discoverAgentProfiles, resolveAgentProfile } = await import(" + JSON.stringify(pathToFileURL(registry!).href) + ");",
      "const catalog = discoverAgentProfiles(process.cwd());",
      "const wanted = " + JSON.stringify(names) + ";",
      "const result = wanted.map((name) => { const profile = catalog.profiles.get(name); if (!profile) throw new Error('Missing agent: ' + name);",
      "return { name, model: profile.model ?? null, resolvedModel: resolveAgentProfile(profile, process.cwd()).resolvedModel ?? null, sourcePath: profile.sourcePath }; });",
      "console.log(JSON.stringify({ profiles: result, warnings: catalog.warnings }));",
    ].join("\n");
    const output = execFileSync(process.execPath, ["--eval", child], {
      cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf8", timeout: 20_000,
    });
    const found = JSON.parse(output) as {
      profiles: Array<{ name: string; model: string | null; resolvedModel: string | null; sourcePath: string }>;
      warnings: string[];
    };
    expect(found.warnings).toEqual([]);
    expect(found.profiles.map((profile) => profile.name).sort()).toEqual([...names].sort());
    for (const profile of found.profiles) {
      expect(profile.model).toBeNull();
      expect(profile.resolvedModel).toBeNull();
      expect(profile.sourcePath).toBe(path.join(agentDir, "agents", profile.name + ".md"));
    }
    expect(planAgents(bundle!, agentDir).agents.every((agent) => agent.action === "present")).toBe(true);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}, { timeout: 30_000 });
