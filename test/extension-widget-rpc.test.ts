/**
 * Command-only integration with installed Pi runtimes, without model calls.
 * The bundled development dependency runs when installed. Add a managed fork:
 * PITTY_TEST_MANAGED_RUNTIME=/path/to/pi/dist/cli.js bun test --conditions=browser test/extension-widget-rpc.test.ts
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PiRpcClient } from "../src/rpc/pi-rpc-client.ts";
import {
  ExtensionWidgetController,
  type ExtensionWidgetRuntime,
} from "../src/tabs/extension-widget-controller.ts";
import type { PiEvent } from "../src/types.ts";

const dependencyCli = path.resolve(
  import.meta.dir, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js",
);
const runtimes = [
  { name: "bundled development dependency", executable: existsSync(dependencyCli) ? dependencyCli : undefined },
  { name: "managed fork", executable: process.env.PITTY_TEST_MANAGED_RUNTIME },
];

class FixtureClient extends PiRpcClient {
  readonly sent: Record<string, unknown>[] = [];

  protected override write(value: Record<string, unknown>): void {
    this.sent.push({ ...value });
    super.write(value);
  }

  async rawMessages(): Promise<unknown[]> {
    return this.data<{ messages: unknown[] }>(await this.request({ type: "get_messages" })).messages;
  }
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const runtime of runtimes) {
  const run = runtime.executable ? test : test.skip;
  run("real widget RPC with " + runtime.name + " preserves strings and history without acknowledgements", async () => {
    if (!runtime.executable || !existsSync(runtime.executable))
      throw new Error("Widget RPC test needs an installed Pi CLI.");
    const directory = await mkdtemp(path.join(os.tmpdir(), "pitty-extension-widget-rpc-"));
    const agentDirectory = path.join(directory, "agent");
    await mkdir(agentDirectory);
    await writeFile(path.join(agentDirectory, "settings.json"), JSON.stringify({
      packages: [],
      compaction: { enabled: false },
      retry: { enabled: false },
    }));
    const client = new FixtureClient({
      cwd: directory,
      executable: runtime.executable,
      args: [
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-tools",
        "--extension", path.join(import.meta.dir, "fixtures", "extension-widget.mjs"),
      ],
      env: {
        PI_CODING_AGENT_DIR: agentDirectory,
        XDG_STATE_HOME: path.join(directory, "state"),
        PITTY_DISABLE_FORK_CODE_TOOL: "1",
      },
      requestTimeoutMs: 15_000,
    });
    const state: ExtensionWidgetRuntime = { id: "isolated-widget-tab" };
    const changes: string[] = [];
    const controller = new ExtensionWidgetController((owner) => changes.push(owner.id));
    const events: PiEvent[] = [];
    client.onEvent((event) => {
      events.push(event);
      controller.handle(event, state);
    });
    try {
      await client.start();
      await client.getState();
      await waitFor(() => state.extensionWidgets?.size === 2, "startup widgets");
      expect([...state.extensionWidgets?.values() ?? []]).toEqual([
        {
          key: "fixture-above",
          placement: "aboveEditor",
          lines: ["\x1b[1;32mBuild status\x1b[0m", "Plain **text** remains literal."],
        },
        { key: "fixture-below", placement: "belowEditor", lines: ["Below editor status"] },
      ]);
      expect(await client.rawMessages()).toEqual([]);

      const commands = (await client.getCommands()).map((command) => command.name);
      expect(commands).toContain("widget-fixture-update");
      expect(commands).toContain("widget-fixture-clear");
      await client.prompt("/widget-fixture-update");
      await waitFor(() => state.extensionWidgets?.size === 1, "widget replacement and removal");
      expect([...state.extensionWidgets?.values() ?? []]).toEqual([
        {
          key: "fixture-above",
          placement: "belowEditor",
          lines: ["\x1b[38;2;34;211;238mUpdated status\x1b[0m", "Second line"],
        },
      ]);
      expect(await client.rawMessages()).toEqual([]);

      await client.prompt("/widget-fixture-clear");
      await waitFor(() => state.extensionWidgets?.size === 0, "final widget removal");
      expect(await client.rawMessages()).toEqual([]);
      expect(changes).toHaveLength(5);
      const widgets = events.filter((event) =>
        event.type === "extension_ui_request" && event.method === "setWidget");
      expect(widgets).toHaveLength(5);
      expect(events.some((event) => event.type === "agent_start" || event.type === "message_start")).toBe(false);
      expect(events.some((event) =>
        event.type === "extension_ui_request" && event.method === "notify")).toBe(false);
      expect(client.sent.some((event) => event.type === "extension_ui_response")).toBe(false);
    } finally {
      await client.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 40_000);
}
