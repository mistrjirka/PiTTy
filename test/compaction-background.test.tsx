import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import type { BackgroundTask } from "../src/state/background-tasks.ts";
import { CompactionPanel } from "../src/ui/compaction-panel.tsx";

const setups: TestRendererSetup[] = [];
afterEach(() => { for (const setup of setups.splice(0)) setup.renderer.destroy(); });

async function mount(
  backgroundTasks: BackgroundTask[],
  options: { expanded?: boolean; height?: number; width?: number; onOpen?: (id: string) => void } = {},
) {
  const width = options.width ?? 72, height = options.height ?? 24;
  const setup = await testRender(() =>
    <box flexDirection="column" width="100%" height="100%">
      <CompactionPanel
        telemetry={{ version: 1, phase: "preparing", startedAt: 1000 }}
        now={13_000}
        spinner="◐"
        frame={2}
        viewportHeight={height}
        expanded={() => options.expanded ?? false}
        backgroundTasks={backgroundTasks}
        {...(options.onOpen ? { onOpenBackgroundTask: options.onOpen } : {})}
      />
      <text>AFTER_COMPACTION_PANEL</text>
    </box>,
    { width, height, useMouse: true, enableMouseMovement: true },
  );
  setups.push(setup);
  await setup.flush();
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
  return setup;
}

const running = (id: string, command: string): BackgroundTask => ({
  id, command, cwd: "/tmp", commandTruncated: false, state: "running", startedAt: 1000,
});

test("compaction shows running commands with elapsed duration and opens the original task", async () => {
  const opened: string[] = [];
  const setup = await mount([running("bg-1", "gh run watch 234 --exit-status")], { onOpen: (id) => opened.push(id) });
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Background commands (1 running)");
  expect(frame).toContain("bg-1");
  expect(frame).toContain("gh run watch 234");
  expect(frame).toContain("AFTER_COMPACTION_PANEL");
  const row = setup.renderer.root.findDescendantById("compaction-background-bg-1");
  expect(row).toBeDefined();
  if (!row) throw new Error("Missing clickable background row");
  await setup.mockMouse.click(row.x + 2, row.y);
  await setup.flush();
  expect(opened).toEqual(["bg-1"]);
});

test("compaction excludes exited commands and does not show empty section", async () => {
  const setup = await mount([{ ...running("bg-1", "done"), state: "exited", exitCode: 0 }]);
  expect(setup.captureCharFrame()).not.toContain("Background commands");
  expect(setup.captureCharFrame()).toContain("AFTER_COMPACTION_PANEL");
});

test("many background jobs stay bounded on a 16-row terminal", async () => {
  const tasks = Array.from({ length: 10 }, (_, index) => running(
    `bg-${index + 1}`, "build job " + "A".repeat(110),
  ));
  const setup = await mount(tasks, { height: 16, width: 40, expanded: true });
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Background commands (10 running)");
  expect(frame).toContain("bg-1");
  expect(frame).not.toContain("bg-10");
  expect(frame).toContain("AFTER_COMPACTION_PANEL");
});

test("short terminal preserves the running count without stretching the panel", async () => {
  const setup = await mount([running("bg-2", "monitor builds")], { height: 8, width: 56 });
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Background commands (1 running)");
  expect(frame).toContain("AFTER_COMPACTION_PANEL");
});
