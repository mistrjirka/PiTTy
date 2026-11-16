import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ScrollBoxRenderable, Renderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { MessageView, toolOutputExpandable } from "../src/ui/message.tsx";
import type { ToolItem } from "../src/types.ts";
import { registerBundledParsers } from "../src/ui/parsers.ts";

registerBundledParsers();
const renderers: Array<{ renderer: { destroy(): void } }> = [];
afterEach(() => {
  for (const setup of renderers.splice(0)) setup.renderer.destroy();
});

function item(output: string): ToolItem {
  return {
    kind: "tool", id: "large-output-test", toolCallId: "large-output-test",
    name: "code", args: { code: "print(1)" }, output,
    timestamp: 1, status: "done", isError: false,
  };
}

describe("large tool output rendering", () => {
  test("shows a bounded collapsed preview without requiring complete output layout", async () => {
    const output = "BEGIN visible\n" + "a".repeat(650_000) + "\nTAIL hidden when collapsed";
    expect(toolOutputExpandable(output)).toBe(true);
    const setup = await testRender(
      () => <MessageView item={item(output)} showThinking toolExpanded={false} />,
      { width: 95, height: 24 },
    );
    renderers.push(setup);
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("BEGIN visible");
    expect(frame).not.toContain("TAIL hidden");
    const hidden = setup.renderer.root.findDescendantById("large-output-test-output-preview");
    expect(hidden).toBeDefined();
    expect(hidden?.visible).toBe(false);
  });

  test("retains the complete output when explicitly expanded", async () => {
    const output = "START\n" + "x".repeat(12_000) + "\nEND_MUST_REMAIN_AVAILABLE";
    const [expanded, setExpanded] = createSignal(false);
    const setup = await testRender(
      () => <MessageView item={item(output)} showThinking toolExpanded={expanded} />,
      { width: 95, height: 24 },
    );
    renderers.push(setup);
    await setup.flush();
    setExpanded(true);
    await setup.flush();
    await setup.waitForVisualIdle({ quietFrames: 3, maxFrames: 150 });
    const preview = setup.renderer.root.findDescendantById("large-output-test-output-preview");
    expect(preview?.visible).toBe(true);
    const toggle = setup.renderer.root.findDescendantById("large-output-test-output-scroll-toggle") as Renderable | undefined;
    expect(toggle).toBeDefined();
    if (!toggle) throw new Error("output scroll toggle missing");
    await setup.mockMouse.click(toggle.x, toggle.y);
    await setup.flush();
    const scroll = setup.renderer.root.findDescendantById("large-output-test-output-scroll") as ScrollBoxRenderable | undefined;
    expect(scroll?.visible).toBe(true);
    if (!scroll) throw new Error("scroll output missing");
    scroll.scrollTo(100_000);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("END_MUST_REMAIN_AVAILABLE");
  });
});
