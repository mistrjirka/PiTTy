import { expect, test } from "bun:test";
import { ExtensionSettingsList } from "../src/ui/extension-settings.tsx";
import { ClaudeAccountSelector } from "../src/ui/claude-account-selector.tsx";
import { compactionMethodRows } from "../src/ui/compaction-policy.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";
useRenderTestEnv();

test("method picker opens the loaded extension with keyboard input", async () => {
  const opened: string[] = [];
  const setup = await mount(() => <ExtensionSettingsList title="Compaction method" backLabel="esc ‹ compaction"
    rows={compactionMethodRows({ compactionMethod: "cache-aware", compactionMethods: [
      { id: "cache-aware", available: true }, { id: "extension", available: true },
    ] })} selectedId="method:cache-aware" busy={false}
    onSelected={() => {}} onOpen={(id) => opened.push(id)} onCancel={() => {}} />);
  expect(setup.captureCharFrame()).toContain("Cache-aware");
  expect(setup.captureCharFrame()).toContain("Two-model extension");
  setup.mockInput.pressArrow("down");
  setup.mockInput.pressEnter();
  await setup.flush();
  expect(opened).toEqual(["method:extension"]);
});

test("an unsupported engine shows its reason and cannot be selected", async () => {
  const opened: string[] = [];
  const setup = await mount(() => <ExtensionSettingsList title="Compaction method" backLabel="esc ‹ compaction"
    rows={compactionMethodRows({ compactionMethod: "cache-aware", compactionMethods: [
      { id: "cache-aware", available: false, reason: "This provider has no reusable conversation cache" },
      { id: "extension", available: false, reason: "One-round compaction is not loaded" },
    ] })} selectedId="method:cache-aware" busy={false}
    onSelected={() => {}} onOpen={(id) => opened.push(id)} onCancel={() => {}} />);
  expect(setup.captureCharFrame()).toContain("This provider has no reusable conversation cache");
  setup.mockInput.pressEnter();
  await setup.flush();
  expect(opened).toEqual([]);
});

test("new-tab account picker names the running account separately from its saved choice", async () => {
  const setup = await mount(() => <ClaudeAccountSelector accounts={[
    { number: 1, label: "work", usageStatus: "ok", usage: { limits: [
      { kind: "session", label: "5h", percent: null, resetAt: null, active: true },
    ] } },
    { number: 2, label: "home", usageStatus: "ok" },
  ]} selection={2} effectiveSlot={2} currentAccountLabel="work"
    onSelect={() => {}} onCancel={() => {}} />);
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Claude account for new tabs");
  expect(frame).toContain("Current tab: work");
  expect(frame).toContain("New tabs: home");
  expect(frame).toContain("Existing tabs keep their account.");
  expect(frame).toContain("5h ?%");
});
