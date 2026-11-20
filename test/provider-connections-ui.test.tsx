import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import { ProviderConnections } from "../src/ui/provider-connections.tsx";
import type { ProviderConnectionService } from "../src/integrations/provider-connections.ts";

const running: TestRendererSetup[] = [];
afterEach(() => { for (const item of running.splice(0)) item.renderer.destroy(); });

describe("provider sign-in screen", () => {
  test("shows subscriptions, keys, status, and the Claude Code command", async () => {
    const service = {
      list: async () => [
        { id: "openai-codex", name: "OpenAI Codex (ChatGPT plan)", methods: ["oauth"], status: "not-configured", stored: false },
        { id: "claude-code", name: "Claude Code (subscription)", methods: [], status: "external", stored: false },
        { id: "opencode-go", name: "OpenCode Go", methods: ["api_key"], status: "configured", stored: true },
      ],
    } as unknown as ProviderConnectionService;
    const item = await testRender(() => (
      <ProviderConnections service={service} onBack={() => {}} onUpdated={async () => {}} />
    ), { width: 100, height: 32 });
    running.push(item);
    await item.flush();
    const screen = item.captureCharFrame();
    expect(screen).toContain("Provider connections");
    expect(screen).toContain("OpenAI Codex");
    expect(screen).toContain("Claude Code");
    expect(screen).toContain("claude auth login");
    expect(screen).toContain("OpenCode Go");
    expect(screen).toContain("API key");
    expect(screen).toContain("Connected");
  });
});
