import { describe, expect, test } from "bun:test";
import {
  CommandCatalogService, localCommandChoices, mergeCommandChoices,
  type CommandClient, type RemoteCommand,
} from "../src/tabs/command-catalog.ts";
import { filterCommandChoices } from "../src/ui/command-suggestions.tsx";

const command = (
  name: string,
  source = "extension",
  description?: string,
): RemoteCommand => ({ name, source, ...(description ? { description } : {}) });

describe("Pi RPC command discovery", () => {
  test("combines live extension/template/skill commands with actual UI commands", () => {
    const result = mergeCommandChoices([
      command("agent_spawn", "extension", "Spawn agent"),
      command("plan", "prompt", "Plan changes"),
      command("skill:godot", "skill", "Godot engine"),
      command("model", "extension", "Do not override the built-in model selector"),
      command("AGENT_SPAWN", "prompt", "Duplicate command"),
    ]);
    expect(result.find((item) => item.name === "agent_spawn")?.source).toBe("extension");
    expect(result.find((item) => item.name === "model")?.source).toBe("ui");
    expect(result.find((item) => item.name === "skill:godot")?.source).toBe("skill");
    expect(result.find((item) => item.name === "plan")?.source).toBe("prompt");
    expect(result.filter((item) => item.name.toLowerCase() === "agent_spawn")).toHaveLength(1);
    expect(result.length).toBe(localCommandChoices.length + 3);
  });

  test("ignores malformed and unsafe remote entries without inventing commands", () => {
    const input = [
      command("some command"), command("/plugin"), command(""),
      command("x".repeat(170)), { name: 12, source: "extension" },
    ] as unknown as RemoteCommand[];
    const result = mergeCommandChoices(input);
    expect(result.some((entry) => entry.name === "plugin")).toBe(true);
    expect(result.some((entry) => entry.name === "some command")).toBe(false);
    expect(result.some((entry) => entry.name.length > 160)).toBe(false);
  });

  test("per-Pi-client snapshots and automatic TTL refresh are isolated", async () => {
    const catalog = new CommandCatalogService(30_000);
    let firstCalls = 0;
    let secondCalls = 0;
    let names = [command("alpha")];
    const first: CommandClient = { async getCommands() { firstCalls++; return names; } };
    const second: CommandClient = { async getCommands() { secondCalls++; return [command("beta")]; } };
    expect(catalog.snapshot(first)).toBe(localCommandChoices);
    await catalog.refresh(first, { now: 0 });
    expect(catalog.snapshot(first).some((entry) => entry.name === "alpha")).toBe(true);
    expect(catalog.snapshot(second).some((entry) => entry.name === "alpha")).toBe(false);
    await catalog.refresh(second, { now: 0 });
    names = [command("gamma")];
    await catalog.refresh(first, { now: 29_999 });
    expect(firstCalls).toBe(1);
    await catalog.refresh(first, { now: 30_000 });
    expect(firstCalls).toBe(2);
    expect(secondCalls).toBe(1);
    expect(catalog.snapshot(first).some((entry) => entry.name === "gamma")).toBe(true);
    expect(catalog.snapshot(second).some((entry) => entry.name === "gamma")).toBe(false);
  });

  test("concurrent refresh is single-flight, and a failed RPC retains the last good list", async () => {
    let calls = 0;
    let finish: ((commands: RemoteCommand[]) => void) | undefined;
    let broken = false;
    const client: CommandClient = {
      getCommands() {
        calls++;
        if (broken) return Promise.reject(new Error("Pi is busy"));
        return new Promise((resolve) => { finish = resolve; });
      },
    };
    const failures: string[] = [];
    const catalog = new CommandCatalogService(15_000, (error) => failures.push(String(error)));
    const first = catalog.refresh(client, { now: 10 });
    const second = catalog.refresh(client, { now: 10 });
    expect(calls).toBe(1);
    finish?.([command("first")]);
    await Promise.all([first, second]);
    broken = true;
    const after = await catalog.refresh(client, { now: 15_010 });
    expect(after.some((entry) => entry.name === "first")).toBe(true);
    expect(failures).toHaveLength(1);
    await catalog.refresh(client, { now: 15_020 });
    expect(calls).toBe(2);
    catalog.invalidate(client);
    await catalog.refresh(client, { now: 15_020 });
    expect(calls).toBe(3);
  });

  test("manual refresh bypasses the TTL without restarting Pi", async () => {
    let calls = 0;
    const client: CommandClient = { async getCommands() {
      calls++;
      return [command(calls === 1 ? "old-name" : "new-name")];
    }};
    const catalog = new CommandCatalogService();
    await catalog.refresh(client, { now: 100 });
    await catalog.refresh(client, { now: 101, force: true });
    expect(calls).toBe(2);
    expect(catalog.snapshot(client).some((entry) => entry.name === "new-name")).toBe(true);
    expect(catalog.snapshot(client).some((entry) => entry.name === "old-name")).toBe(false);
  });
});

describe("slash command discoverability", () => {
  const choices = [
    ...localCommandChoices,
    { name: "skill:game-design", source: "skill", description: "Make a level" },
    { name: "agent_spawn", source: "extension", description: "Run implementer" },
    { name: "skill:documentation", source: "skill", description: "Welding instructions" },
  ];
  test("bare slash includes all registered commands in alphabetical order", () => {
    const results = filterCommandChoices(choices, "/");
    expect(results).toHaveLength(choices.length);
    expect(results.map((item) => item.name)).toEqual(
      [...choices.map((item) => item.name)].sort((a, b) => a.localeCompare(b)),
    );
    expect(results.map((item) => item.name)).toContain("skill:documentation");
  });
  test("finds segment, substring and description matches without hiding exact commands", () => {
    expect(filterCommandChoices(choices, "/spawn").map((item) => item.name)).toContain("agent_spawn");
    expect(filterCommandChoices(choices, "/game").map((item) => item.name)).toContain("skill:game-design");
    expect(filterCommandChoices(choices, "/weld").map((item) => item.name)).toContain("skill:documentation");
    expect(filterCommandChoices(choices, "/model").at(0)?.name).toBe("model");
  });
  test("supports scrolling past the first seven while leaving argument completion alone", () => {
    expect(filterCommandChoices(choices, "/", 24).length).toBeGreaterThan(7);
    expect(filterCommandChoices(choices, "/thinking high")).toEqual([]);
    expect(filterCommandChoices(choices, "/model", 24, 0)).toEqual([]);
  });
});
