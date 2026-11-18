import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createSignal, For, Show } from "solid-js";
import type { ConversationItem } from "../src/types.ts";
import { MessageView } from "../src/ui/message.tsx";
import { colors } from "../src/ui/theme.ts";

const setups: TestRendererSetup[] = [];
afterEach(() => { for (const setup of setups.splice(0)) setup.renderer.destroy(); });
async function mount(render: () => any, width = 57, height = 18) {
  const setup = await testRender(render, {
    width, height, useMouse: true, enableMouseMovement: true,
  });
  setups.push(setup);
  await setup.flush();
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
  return setup;
}
async function frame(setup: TestRendererSetup) {
  await setup.flush();
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
  return setup.captureCharFrame();
}
function assertNoGhost(value: string, marker: string) {
  expect(value).not.toContain(marker);
}

test("native text replaces content with wider, shorter, and space-heavy content", async () => {
  const [value, setValue] = createSignal("OLD_GHOST_ABCDEFGHIJKLMNOPQRSTUVWXYZ twice twice twice twice twice");
  const setup = await mount(() => <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
    <text wrapMode="word" width="100%">{value()}</text>
    <text>FOLLOWING_SENTINEL</text>
  </box>, 42, 14);
  expect(await frame(setup)).toContain("OLD_GHOST");
  setValue("A       B  new content that is longer in some places");
  let f = await frame(setup);
  assertNoGhost(f, "OLD_GHOST");
  expect(f).toContain("FOLLOWING_SENTINEL");
  setValue("SHORT");
  f = await frame(setup);
  assertNoGhost(f, "new content");
  expect(f).toContain("SHORT");
  expect(f).toContain("FOLLOWING_SENTINEL");
});

test("scrollbox clears the old area after wrapping a growing and shrinking text node", async () => {
  const [text, setText] = createSignal("GHOST_WRAP_" + "X".repeat(90));
  const setup = await mount(() => <scrollbox width="100%" height="100%" scrollY viewportCulling backgroundColor={colors.background}>
    <box width="100%" flexDirection="column">
      <text wrapMode="word">{text()}</text>
      <text id="sentinel">NEXT_BLOCK_IS_CLEAN</text>
    </box>
  </scrollbox>, 35, 13);
  expect(await frame(setup)).toContain("GHOST_WRAP");
  setText("One  two    three");
  const f = await frame(setup);
  assertNoGhost(f, "GHOST_WRAP");
  expect(f).toContain("NEXT_BLOCK_IS_CLEAN");
});

test("user message update does not retain old words in the same text area", async () => {
  const [item, setItem] = createSignal<ConversationItem>({
    kind: "user", id: "user-test", text: "OLD_GHOST the original message stretches across three entire rows with words words", timestamp: 1, optimistic: false,
  });
  const setup = await mount(() => <scrollbox width="100%" height="100%" scrollY viewportCulling backgroundColor={colors.background}>
    <MessageView item={item} showThinking toolExpanded={false} />
    <text>AFTER_USER_SENTINEL</text>
  </scrollbox>, 56, 18);
  expect(await frame(setup)).toContain("OLD_GHOST");
  setItem({ kind: "user", id: "user-test", text: "NEW  longer   with  spaces", timestamp: 1, optimistic: false });
  const f = await frame(setup);
  assertNoGhost(f, "OLD_GHOST");
  expect(f).toContain("AFTER_USER_SENTINEL");
  expect(f).toContain("NEW");
});

test("assistant transition from live text to markdown clears the old content", async () => {
  const [item, setItem] = createSignal<ConversationItem>({
    kind: "assistant", id: "assistant-test", text: "OLD_GHOST_ANSWER " + "ABCD ".repeat(13), thinking: "OLD_GHOST_THOUGHT " + "EFGH ".repeat(6), timestamp: 1, status: "streaming",
  });
  const setup = await mount(() => <scrollbox width="100%" height="100%" scrollY viewportCulling backgroundColor={colors.background}>
    <MessageView item={item} showThinking thinkingExpanded toolExpanded={false} />
    <text>AFTER_ASSISTANT_SENTINEL</text>
  </scrollbox>, 66, 20);
  expect(await frame(setup)).toContain("OLD_GHOST");
  setItem({
    kind: "assistant", id: "assistant-test", text: "New rendered answer with  spaces", thinking: "Revised thinking", timestamp: 1, status: "done",
  });
  const f = await frame(setup);
  assertNoGhost(f, "OLD_GHOST");
  expect(f).toContain("New rendered answer");
  expect(f).toContain("AFTER_ASSISTANT_SENTINEL");
});

test("tool output changes and collapse remove the preceding longer text", async () => {
  const [item, setItem] = createSignal<ConversationItem>({
    kind: "tool", id: "tool-test", toolCallId: "tool-1", name: "bash", args: {}, output: "OLD_GHOST_TOOL " + "TEST ".repeat(70), timestamp: 1, status: "done", isError: false,
  });
  const [expanded, setExpanded] = createSignal(true);
  const setup = await mount(() => <scrollbox width="100%" height="100%" scrollY viewportCulling backgroundColor={colors.background}>
    <MessageView item={item} showThinking toolExpanded={expanded} />
    <text>AFTER_TOOL_SENTINEL</text>
  </scrollbox>, 78, 22);
  expect(await frame(setup)).toContain("OLD_GHOST");
  setItem({kind:"tool", id:"tool-test", toolCallId:"tool-1", name:"bash", args:{}, output:"NEW  output", timestamp:1, status:"done", isError:false});
  setExpanded(false);
  const f = await frame(setup);
  assertNoGhost(f, "OLD_GHOST");
  expect(f).toContain("NEW");
  expect(f).toContain("AFTER_TOOL_SENTINEL");
});
