import { describe, expect, test } from "bun:test";
import {
  SlashCommandController, type SlashCommandPorts, type SlashRuntime, parseOnOff,
} from "../src/tabs/slash-commands.ts";
import { reconcileExtensionWidgetSession } from "../src/state/extension-widgets.ts";

function fixture() {
  const calls: string[] = [];
  const notices: Array<{ message: string; tone: string }> = [];
  let expanded = true;
  let sidebar = true;
  let thinkingExpanded = false;
  let promptCount = 1;
  const runtime: SlashRuntime = {
    conversation: { isCompacting: false },
    sessionState: {
      model: { provider: "test", id: "first" },
      thinkingLevel: "medium",
    },
    client: {
      async setAutoCompaction(enabled) { calls.push("auto:" + enabled); },
      async setAutoRetry(enabled) { calls.push("retry:" + enabled); },
      async setSteeringMode(mode) { calls.push("steer:" + mode); },
      async setFollowUpMode(mode) { calls.push("followup:" + mode); },
      async setThinkingLevel(level) { calls.push("thinking:" + level); },
      async setModel(provider, model) { calls.push("model:" + provider + "/" + model); },
      async getCommands() { return [{ name: "plugin", description: "External", source: "extension" }]; },
      async compact(instructions) { calls.push("compact:" + (instructions ?? "")); },
      async newSession() { calls.push("new"); },
      async setSessionName(name) { calls.push("name:" + name); },
    },
  };
  const ports: SlashCommandPorts<SlashRuntime> = {
    addSystem(_runtime, message, tone = "info") { notices.push({ message, tone }); },
    openSessionSelector() { calls.push("sessions"); },
    openSettings() { calls.push("settings"); },
    openProviders() { calls.push("providers"); },
    expandedTools() { return expanded; },
    setExpandedTools(value) { expanded = value; calls.push("tools:" + value); },
    setExpandedToolIds(value) { calls.push("toolids:" + value.size); },
    sidebarEnabled() { return sidebar; },
    setSidebarEnabled(value) { sidebar = value; calls.push("sidebar:" + value); },
    async refreshState() { calls.push("refresh"); return true; },
    async refreshCommands() { calls.push("commands-refresh"); return [{ name: "plugin", description: "External" }]; },
    autoRetryEnabled() { return true; },
    setAutoRetryEnabled(value) { calls.push("local-retry:" + value); },
    rememberThinkingLevel(_runtime, level) { calls.push("remember:" + (level ?? "")); },
    async applyRememberedThinkingLevel(_runtime, provider, model) { calls.push("apply:" + provider + "/" + model); },
    async fetchAvailableModels() { return [{ provider: "test", id: "first" }, { provider: "other", id: "second" }]; },
    async loadCurrentSession() { calls.push("load"); },
    setSkillSelectorOpen(value) { calls.push("skills:" + value); },
    setAllThinkingExpanded(value) { thinkingExpanded = value; calls.push("thoughts:" + value); },
    thinkingExpanded() { return thinkingExpanded; },
    promptMapCount() { return promptCount; },
    setPromptMapOpen(value) { calls.push("promptmap:" + value); },
    openMemoryBrowser() { calls.push("memory"); },
  };
  const controller = new SlashCommandController(ports);
  return { controller, runtime, ports, calls, notices, setPromptCount(value: number) { promptCount = value; } };
}

describe("typed built-in slash command controller", () => {
  test("unknown extension commands and plain text remain available to Pi", async () => {
    const f = fixture();
    expect(await f.controller.handle("/plugin argument", f.runtime)).toBe(false);
    expect(await f.controller.handle("not a command", f.runtime)).toBe(false);
    expect(f.calls).toEqual([]);
    expect(f.notices).toEqual([]);
  });

  test("UI toggles do not call Pi and clear expansion overrides when closing", async () => {
    const f = fixture();
    expect(await f.controller.handle("/tools off", f.runtime)).toBe(true);
    expect(await f.controller.handle("/sidebar off", f.runtime)).toBe(true);
    expect(f.calls).toEqual(["tools:false", "toolids:0", "sidebar:false"]);
    expect(f.notices.at(-1)?.tone).toBe("success");
    expect(parseOnOff("disabled")).toBe(false);
    expect(parseOnOff("invalid")).toBeUndefined();
  });

  test("model and thinking settings preserve Pi RPC order", async () => {
    const f = fixture();
    await f.controller.handle("/model other/second", f.runtime);
    await f.controller.handle("/thinking high", f.runtime);
    expect(f.calls).toEqual([
      "remember:", "model:other/second", "apply:other/second",
      "refresh", "thinking:high", "refresh", "remember:high",
    ]);
    await f.controller.handle("/thinking nonsense", f.runtime);
    expect(f.notices.at(-1)?.tone).toBe("warning");
  });

  test("compaction remains guarded and session actions remain explicit", async () => {
    const f = fixture();
    f.runtime.conversation.isCompacting = true;
    await f.controller.handle("/compact", f.runtime);
    expect(f.calls).toEqual([]);
    f.runtime.conversation.isCompacting = false;
    await f.controller.handle("/compact keep task context", f.runtime);
    await f.controller.handle("/new", f.runtime);
    await f.controller.handle("/name New session", f.runtime);
    expect(f.calls).toEqual(["compact:keep task context", "refresh", "new", "load", "name:New session", "refresh"]);
  });

  test("new-session cleanup preserves widgets received before the command acknowledgement", async () => {
    const f = fixture();
    f.runtime.extensionWidgets = new Map([
      ["old", { key: "old", lines: ["stale"], placement: "aboveEditor" }],
    ]);
    f.runtime.client.newSession = async () => {
      f.runtime.extensionWidgets?.set("new", { key: "new", lines: ["startup"], placement: "aboveEditor" });
    };
    f.ports.loadCurrentSession = async (runtime) => {
      reconcileExtensionWidgetSession(runtime, "old session", "new session");
    };
    await f.controller.handle("/new", f.runtime);
    expect([...f.runtime.extensionWidgets.values()]).toEqual([
      { key: "new", lines: ["startup"], placement: "aboveEditor" },
    ]);
  });

  test("navigation and introspection map to the correct UI controls", async () => {
    const f = fixture();
    await f.controller.handle("/sessions", f.runtime);
    await f.controller.handle("/settings", f.runtime);
    await f.controller.handle("/login", f.runtime);
    await f.controller.handle("/status", f.runtime);
    await f.controller.handle("/thoughts expanded", f.runtime);
    await f.controller.handle("/prompts", f.runtime);
    await f.controller.handle("/skills", f.runtime);
    await f.controller.handle("/memory", f.runtime);
    await f.controller.handle("/commands", f.runtime);
    await f.controller.handle("/models", f.runtime);
    expect(f.calls).toEqual(["sessions", "settings", "providers", "thoughts:true", "promptmap:true", "skills:true", "commands-refresh", "memory", "commands-refresh"]);
    expect(f.notices.some((n) => n.message.includes("Settings available in this RPC UI"))).toBe(true);
    expect(f.notices.some((n) => n.message.includes("/plugin — External"))).toBe(true);
    expect(f.notices.some((n) => n.message.includes("other/second"))).toBe(true);
  });

  test("missing prompt history reports truthfully without opening the selector", async () => {
    const f = fixture();
    f.setPromptCount(0);
    await f.controller.handle("/map", f.runtime);
    expect(f.calls).toEqual([]);
    expect(f.notices.at(-1)?.message).toContain("No user requests");
  });
});
