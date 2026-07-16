import { afterEach, describe, expect, test } from "bun:test";
import type { TextareaRenderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { Show, createSignal } from "solid-js";
import { cleanThinkingText, MessageView, toolOutputExpandable } from "../src/ui/message.tsx";
import { filterModelChoices, formatContextWindow, ModelSelectorDialog, normalizeModelChoices } from "../src/ui/model-selector.tsx";
import { PromptMapDialog } from "../src/ui/prompt-map.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import { SubagentInspector } from "../src/ui/subagent-inspector.tsx";
import { SubagentSelectorDialog } from "../src/ui/subagent-selector.tsx";
import { subagentTargets } from "../src/subagents/targets.ts";
import type { ConversationItem, RpcSessionState, SessionStats, SubagentRun } from "../src/types.ts";
import { registerBundledParsers } from "../src/ui/parsers.ts";
import { CommandSuggestions, filterCommandChoices } from "../src/ui/command-suggestions.tsx";
import { SessionSelector } from "../src/ui/session-selector.tsx";
import { EmptyDashboard } from "../src/ui/empty-dashboard.tsx";
import { Logo } from "../src/ui/logo.tsx";
import { shouldShowEmptyDashboard } from "../src/app.tsx";
import type { SessionChoice, SessionDiscoveryState } from "../src/sessions.ts";
import { deriveTodos } from "../src/ui/todos.tsx";
import { nextDetailToggle } from "../src/app.tsx";
import { PendingInputPanel } from "../src/ui/pending-input-panel.tsx";
import { appVersion } from "../src/version.ts";

registerBundledParsers();

const active: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of active.splice(0)) setup.renderer.destroy();
});

async function mount(node: () => unknown, width = 100, height = 30): Promise<TestRendererSetup> {
  const setup = await testRender(node as () => never, { width, height, useMouse: true, enableMouseMovement: true });
  active.push(setup);
  await setup.flush();
  await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
  return setup;
}

describe("OpenTUI components", () => {
  test("renders every session picker state and selects the first search result", async () => {
    const choice: SessionChoice = {
      path: "/tmp/target.jsonl",
      id: "target",
      name: "Target session",
      modified: new Date("2024-01-01T00:00:00Z"),
      messageCount: 3,
      firstMessage: "Find the target",
    };
    const renderState = async (state: SessionDiscoveryState, switching = false) => {
      const setup = await mount(() => <SessionSelector state={state} switching={switching} onSelect={() => {}} onCancel={() => {}} />);
      return setup.captureCharFrame();
    };

    expect(await renderState({ kind: "loading" })).toContain("Loading sessions…");
    expect(await renderState({ kind: "loading", progress: { loaded: 1, total: 2 } })).toContain("Loading sessions… 1/2");
    expect(await renderState({ kind: "empty", choices: [] })).toContain("No resumable sessions in this directory.");
    expect(await renderState({ kind: "error", error: "permission denied" })).toContain("Unable to discover sessions: permission denied");
    expect(await renderState({ kind: "success", choices: [choice] })).toContain("Target session");

    let selected: SessionChoice | undefined;
    const setup = await mount(() => <SessionSelector state={{ kind: "success", choices: [choice] }} onSelect={(value) => { selected = value; }} onCancel={() => {}} />);
    await setup.mockInput.typeText("target");
    setup.mockInput.pressEnter();
    await setup.flush();
    expect(selected).toEqual(choice);
  });

  test("renders wide and compact logo variants without clipping", async () => {
    const wide = await mount(() => <Logo />, 80, 8);
    expect(wide.captureCharFrame()).toContain("■────╮");
    const compact = await mount(() => <Logo compact />, 24, 8);
    const frame = compact.captureCharFrame();
    expect(frame).toContain("■───╮");
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(24);
  });

  test("renders the wordmark-only logo variant", async () => {
    const setup = await mount(() => <Logo wordmarkOnly />, 80, 8);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("PiTTy");
    expect(frame).not.toContain("■");
  });

  test("renders the empty dashboard states and keeps constrained content inside the viewport", async () => {
    const choice: SessionChoice = { path: "/tmp/dashboard", id: "dashboard", name: "Dashboard work", modified: new Date(), messageCount: 2, firstMessage: "Dashboard work" };
    const states: SessionDiscoveryState[] = [
      { kind: "loading" },
      { kind: "success", choices: [choice] },
      { kind: "empty", choices: [] },
      { kind: "error", error: "permission denied" },
    ];
    for (const state of states) {
      const setup = await mount(() => <EmptyDashboard sessionState={state} onSelectSession={() => {}} />, 44, 16);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("PiTTy");
      expect(frame).not.toContain("undefined");
      const expectedText = state.kind === "loading"
        ? "Loading recent sessions…"
        : state.kind === "success" ? "Dashboard work"
        : state.kind === "empty" ? "No recent sessions in this directory."
        : "Unable to load recent sessions:";
      expect(frame).toContain(expectedText);
      for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(44);
    }
    expect(shouldShowEmptyDashboard(0)).toBe(true);
    expect(shouldShowEmptyDashboard(1)).toBe(false);
  });

  test("keeps the wordmark and session state readable at constrained height", async () => {
    const setup = await mount(() => (
      <EmptyDashboard
        sessionState={{ kind: "loading" }}
        width={44}
        height={10}
        onSelectSession={() => {}}
      />
    ), 44, 10);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("PiTTy");
    expect(frame).toContain("Loading recent sessions");
    expect(frame).not.toContain("■───╮");
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(44);
  });

  test("dashboard leaves the prompt editor focusable", async () => {
    let editor: TextareaRenderable | undefined;
    const setup = await mount(() => (
      <box flexDirection="column" width="100%" height="100%">
        <box flexGrow={1}><EmptyDashboard sessionState={{ kind: "loading" }} onSelectSession={() => {}} /></box>
        <textarea ref={(value) => { editor = value; }} focused height={2} />
      </box>
    ), 70, 16);
    await setup.mockInput.typeText("draft while dashboard is visible");
    expect(editor?.plainText).toBe("draft while dashboard is visible");
  });

  test("dashboard session rows use the shared choice callback", async () => {
    const choice: SessionChoice = { path: "/tmp/dashboard", id: "dashboard", name: "Dashboard work", modified: new Date(), messageCount: 2, firstMessage: "Dashboard work" };
    let selected: SessionChoice | undefined;
    const setup = await mount(() => <EmptyDashboard sessionState={{ kind: "success", choices: [choice] }} onSelectSession={(value) => { selected = value; }} />);
    const frame = setup.captureCharFrame();
    const y = frame.split("\n").findIndex((line) => line.includes("Dashboard work"));
    expect(y).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(Math.max(0, frame.split("\n")[y]!.indexOf("Dashboard work")), y);
    await setup.flush();
    expect(selected).toEqual(choice);
  });

  test("model and session selectors accept immediate keyboard search, navigation, selection, and cancel", async () => {
    const models = [{ provider: "openai", id: "alpha", name: "Alpha" }, { provider: "anthropic", id: "beta", name: "Beta" }];
    let selectedModel: string | undefined;
    const modelSetup = await mount(() => <ModelSelectorDialog models={models} onSelect={(model) => { selectedModel = model.id; }} onCancel={() => {}} />);
    await modelSetup.mockInput.typeText("beta");
    await modelSetup.flush();
    expect(modelSetup.captureCharFrame()).toContain("anthropic/beta");
    modelSetup.mockInput.pressArrow("down");
    await modelSetup.flush();
    modelSetup.mockInput.pressEnter();
    await modelSetup.flush();
    expect(selectedModel).toBe("beta");

    let selected = 0;
    const choice: SessionChoice = { path: "/tmp/session", id: "session", name: "Planning", modified: new Date(), messageCount: 1, firstMessage: "Planning" };
    const sessionSetup = await mount(() => <SessionSelector state={{ kind: "success", choices: [choice] }} onSelect={() => { selected += 1; }} onCancel={() => {}} />);
    await sessionSetup.mockInput.typeText("planning");
    await sessionSetup.flush();
    sessionSetup.mockInput.pressArrow("up");
    await sessionSetup.flush();
    sessionSetup.mockInput.pressArrow("down");
    await sessionSetup.flush();
    sessionSetup.mockInput.pressEnter();
    await sessionSetup.flush();
    expect(selected).toBe(1);

    let cancelled = 0;
    const cancelSetup = await mount(() => <SessionSelector state={{ kind: "success", choices: [choice] }} onSelect={() => {}} onCancel={() => { cancelled += 1; }} />);
    cancelSetup.mockInput.pressEscape();
    await Bun.sleep(30);
    await cancelSetup.flush();
    expect(cancelled).toBe(1);
  });

  test("session selector confirms and declines pending streaming switches", async () => {
    const choice: SessionChoice = { path: "/tmp/pending", id: "pending", name: "Pending session", modified: new Date(), messageCount: 1, firstMessage: "Pending" };
    let confirmed = 0;
    const enterSetup = await mount(() => <SessionSelector state={{ kind: "success", choices: [choice] }} streaming pending={choice} onSelect={() => {}} onCancel={() => {}} onConfirm={() => { confirmed += 1; }} onDecline={() => {}} />);
    enterSetup.mockInput.pressKey("y");
    await enterSetup.flush();
    expect(confirmed).toBe(1);

    let declined = 0;
    const declineSetup = await mount(() => <SessionSelector state={{ kind: "success", choices: [choice] }} streaming pending={choice} onSelect={() => {}} onCancel={() => {}} onConfirm={() => {}} onDecline={() => { declined += 1; }} />);
    declineSetup.mockInput.pressKey("n");
    await declineSetup.flush();
    expect(declined).toBe(1);
  });

  test("selector selection and cancellation restore keyboard input to the chat editor", async () => {
    const models = [{ provider: "anthropic", id: "beta", name: "Beta" }];
    let modelEditor: TextareaRenderable | undefined;
    const [modelOpen, setModelOpen] = createSignal(true);
    const closeModel = () => {
      setModelOpen(false);
      queueMicrotask(() => modelEditor?.focus());
    };
    const modelSetup = await mount(() => (
      <box flexDirection="column">
        <textarea ref={(value) => { modelEditor = value; }} focused={!modelOpen()} height={1} />
        <Show when={modelOpen()}><ModelSelectorDialog models={models} onSelect={closeModel} onCancel={closeModel} /></Show>
      </box>
    ));
    await modelSetup.mockInput.typeText("beta");
    modelSetup.mockInput.pressEnter();
    await modelSetup.flush();
    await modelSetup.mockInput.typeText("chat after model");
    expect(modelEditor?.plainText).toBe("chat after model");

    const choice: SessionChoice = { path: "/tmp/session", id: "session", name: "Planning", modified: new Date(), messageCount: 1, firstMessage: "Planning" };
    let sessionEditor: TextareaRenderable | undefined;
    const [sessionOpen, setSessionOpen] = createSignal(true);
    const closeSession = () => {
      setSessionOpen(false);
      queueMicrotask(() => sessionEditor?.focus());
    };
    const sessionSetup = await mount(() => (
      <box flexDirection="column">
        <textarea ref={(value) => { sessionEditor = value; }} focused={!sessionOpen()} height={1} />
        <Show when={sessionOpen()}><SessionSelector state={{ kind: "success", choices: [choice] }} onSelect={closeSession} onCancel={closeSession} /></Show>
      </box>
    ));
    sessionSetup.mockInput.pressEscape();
    await Bun.sleep(30);
    await sessionSetup.flush();
    await sessionSetup.mockInput.typeText("chat after session");
    expect(sessionEditor?.plainText).toBe("chat after session");
  });

  test("removes repeated provider thinking headings without changing prose", () => {
    expect(cleanThinkingText("Thinking:\nThinking: **Planning work**")).toBe("**Planning work**");
    expect(cleanThinkingText("Reasoning\nThinking: inspect files")).toBe("inspect files");
    expect(cleanThinkingText("Thinking about the safest approach")).toBe("Thinking about the safest approach");
  });

  test("renders main and subagent thinking as sanitized Markdown", async () => {
    const assistant: ConversationItem = {
      kind: "assistant",
      id: "markdown-thinking",
      text: "",
      thinking: "\u001b[38;2;34;211;238mThinking:\u001b[39m **Planning validation**\n\n- inspect tests\n- run typecheck",
      timestamp: 1,
      status: "done",
    };
    const run: SubagentRun = {
      runId: "run-markdown",
      asyncDir: "/tmp/run-markdown",
      mode: "single",
      state: "running",
      agent: "implementer",
      steps: [],
    };
    const tool: ConversationItem = {
      kind: "tool",
      id: "subagent-tool",
      toolCallId: "subagent-tool",
      name: "bash",
      args: "bun test",
      output: "5 pass\n0 fail",
      timestamp: 2,
      startedAt: 2,
      endedAt: 349,
      status: "done",
      isError: false,
    };

    const main = await mount(() => <MessageView item={assistant} showThinking thinkingExpanded toolExpanded={false} />);
    const mainFrame = main.captureCharFrame();
    expect(mainFrame).toContain("Planning validation");
    expect(mainFrame).toContain("inspect tests");
    expect(mainFrame).not.toContain("[38;2;");
    expect(mainFrame).not.toContain("**Planning");

    const subagent = await mount(() => (
      <SubagentInspector
        run={run}
        items={[assistant, tool]}
        now={1_000}
        thinkingExpanded={() => true}
        toolExpanded={() => false}
        diffExpanded={() => false}
      />
    ), 110, 30);
    const subagentFrame = subagent.captureCharFrame();
    expect(subagentFrame).toContain("Planning validation");
    expect(subagentFrame).toContain("TOOL · bash");
    expect(subagentFrame).toContain("5 pass");
    expect(subagentFrame).not.toContain("[38;2;");
  });

  test("only makes tool output expandable when it actually needs more space", () => {
    expect(toolOutputExpandable("5 pass\n0 fail")).toBe(false);
    expect(toolOutputExpandable("one\ntwo\nthree\nfour\nfive")).toBe(true);
    expect(toolOutputExpandable("x".repeat(321))).toBe(true);
  });

  test("renders distinct user, assistant, and tool messages", async () => {
    const items: ConversationItem[] = [
      { kind: "user", id: "u", text: "Please inspect the tests", timestamp: 1, optimistic: false },
      { kind: "assistant", id: "a", text: "I found **two** relevant files.", thinking: "checking", timestamp: 2, status: "done" },
      { kind: "tool", id: "t", toolCallId: "tool-1", name: "bash", args: { command: "bun test" }, output: "5 pass\n0 fail", timestamp: 3, status: "done", isError: false },
    ];
    const setup = await mount(() => (
      <box width="100%" height="100%" flexDirection="column">
        {items.map((item) => <MessageView item={item} showThinking toolExpanded={false} />)}
      </box>
    ));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Please inspect the tests");
    expect(frame).toContain("two relevant files");
    expect(frame).toContain("bash");
    expect(frame).toContain("5 pass");
    expect(frame).not.toContain("click to expand");
    expect(frame).not.toContain("▶");
  });


  test("renders colorful tool cards with a collapsible diff", async () => {
    const item: ConversationItem = {
      kind: "tool",
      id: "edit-diff",
      toolCallId: "edit-diff",
      name: "edit",
      args: { path: "src/app.ts", edits: [] },
      output: "Applied edit",
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old value\n+new value\n",
      diffPath: "src/app.ts",
      timestamp: 1,
      status: "done",
      isError: false,
    };
    const collapsed = await mount(() => <MessageView item={item} showThinking toolExpanded={false} diffExpanded={false} />);
    const collapsedFrame = collapsed.captureCharFrame();
    expect(collapsedFrame).toContain("TOOL · edit");
    expect(collapsedFrame).toContain("Changes");
    expect(collapsedFrame).toContain("+1");
    expect(collapsedFrame).toContain("-1");
    expect(collapsedFrame).not.toContain("old value");

    const expanded = await mount(() => <MessageView item={item} showThinking toolExpanded={false} diffExpanded />);
    const expandedFrame = expanded.captureCharFrame();
    expect(expandedFrame).toContain("old value");
    expect(expandedFrame).toContain("new value");
  });

  test("hides optional integration panels when packages are unavailable", async () => {
    const setup = await mount(() => (
      <Sidebar runs={[]} subagentsAvailable={false} todosAvailable={false} todos={[]} />
    ), 42, 28);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Session");
    expect(frame).not.toContain("Subagents");
    expect(frame).not.toContain("Todos");
    expect(frame).not.toContain("Ctrl+I inspect");
  });

  test("renders session and subagent status in the sidebar", async () => {
    const state = {
      sessionId: "session-1",
      sessionName: "OpenCode UI work",
      thinkingLevel: "high",
      isStreaming: true,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      messageCount: 8,
      pendingMessageCount: 0,
      model: { provider: "openai-codex", id: "gpt-5.6-sol", contextWindow: 400000 },
    } as RpcSessionState;
    const stats = {
      sessionFile: "/tmp/session.jsonl",
      sessionId: "session-1",
      userMessages: 2,
      assistantMessages: 2,
      toolCalls: 2,
      toolResults: 2,
      totalMessages: 8,
      tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
      cost: 0,
      contextUsage: { tokens: 33000, contextWindow: 400000, percent: 8.25 },
    } as SessionStats;
    const runs: SubagentRun[] = [{
      runId: "run-1",
      asyncDir: "/tmp/run-1",
      mode: "single",
      state: "running",
      agent: "implementer",
      totalTokens: 4200,
      currentTool: "bash",
      steps: [],
    }];
    const setup = await mount(() => <Sidebar state={state} stats={stats} runs={runs} selectedRunId="run-1" />, 42, 28);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("OpenCode UI work");
    expect(frame).toContain(`PiTTy v${appVersion}`);
    expect(frame).toContain("gpt-5.6-sol");
    expect(frame).toContain("implementer");
    expect(frame).toContain("running");
    expect(frame).not.toContain("Selected");
  });

  test("renders live assistant output as stable plain text and tool timing", async () => {
    const items: ConversationItem[] = [
      { kind: "assistant", id: "live", text: "Streaming **unfinished", thinking: "Thinking: checking", timestamp: 2, status: "streaming" },
      {
        kind: "tool",
        id: "tool-time",
        toolCallId: "tool-time",
        name: "bash",
        args: { command: "sleep 1", timeout: 30_000 },
        output: "running",
        timestamp: 3,
        startedAt: 1_000,
        timeoutMs: 30_000,
        status: "streaming",
        isError: false,
      },
    ];
    const setup = await mount(() => (
      <box width="100%" height="100%" flexDirection="column">
        {items.map((item) => <MessageView item={item} showThinking toolExpanded={false} now={6_000} />)}
      </box>
    ));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Streaming **unfinished");
    expect(frame).toContain("checking");
    expect(frame.match(/Thinking/g)?.length).toBe(1);
    expect(frame).toContain("5s / timeout 30s");
  });
  test("global details toggle collapses mixed individual overrides", () => {
    expect(nextDetailToggle({ toolsExpanded: false, thinkingExpanded: false, hasExpandedToolOverride: true })).toBe(false);
    expect(nextDetailToggle({ toolsExpanded: false, thinkingExpanded: false })).toBe(true);
  });

  test("normalizes and renders the Ctrl+P model list", async () => {
    const models = normalizeModelChoices([
      { provider: "openai-codex", id: "gpt-5.6-terra", name: "GPT-5.6 Terra", contextWindow: 400000 },
      { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 1000000 },
      { provider: "openai-codex", id: "gpt-5.6-sol", name: "duplicate" },
      null,
    ]);
    expect(models).toHaveLength(2);
    const setup = await mount(() => (
      <ModelSelectorDialog
        models={models}
        currentProvider="openai-codex"
        currentModelId="gpt-5.6-terra"
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ), 90, 24);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Select model");
    expect(frame).toContain("openai-codex/gpt-5.6-sol");
    expect(frame).toContain("openai-codex/gpt-5.6-terra");
    expect(frame).toContain("400k ctx");
    expect(frame).toContain("1M ctx");
    expect(formatContextWindow(128000)).toBe("128k ctx");
    expect(filterModelChoices(models, "SOL").map((model) => model.id)).toEqual(["gpt-5.6-sol"]);
    expect(filterModelChoices(models, "terra").map((model) => model.id)).toEqual(["gpt-5.6-terra"]);
    expect(filterModelChoices(models, "missing")).toEqual([]);
    const emptySetup = await mount(() => (
      <ModelSelectorDialog models={[]} onSelect={() => {}} onCancel={() => {}} />
    ), 90, 16);
    expect(emptySetup.captureCharFrame()).toContain("Tab list");
    expect(emptySetup.captureCharFrame()).toContain("No matching models.");
  });

  test("keeps the main draft visible beneath the selector reservation", async () => {
    const setup = await mount(() => (
      <box width="100%" height="100%" flexDirection="column">
        <box flexGrow={1} />
        <textarea
          ref={(value) => { value.setText("unsent draft"); }}
          height={4}
          minHeight={4}
        />
        <ModelSelectorDialog
          models={[{ provider: "local", id: "draft-model" }]}
          onSelect={() => {}}
          onCancel={() => {}}
        />
      </box>
    ), 70, 14);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("unsent draft");
    expect(frame).toContain("Search provider");
  });

  test("subagent inspector has a working mouse close target", async () => {
    let closed = 0;
    const run: SubagentRun = {
      runId: "run-close",
      asyncDir: "/tmp/run-close",
      mode: "single",
      state: "running",
      agent: "implementer",
      steps: [],
    };
    const setup = await mount(() => (
      <SubagentInspector run={run} items={[]} now={2_000} onClose={() => { closed += 1; }} />
    ), 90, 24);
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n");
    const y = lines.findIndex((line) => line.includes("Main chat"));
    const x = y >= 0 ? lines[y]!.indexOf("Main chat") + 2 : -1;
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(x, y);
    await Bun.sleep(60);
    await setup.flush();
    expect(closed).toBeGreaterThan(0);
  });


  test("keeps pending steering text intact in an 80x10 layout", async () => {
    const setup = await mount(() => (
      <box width="100%" height="100%" flexDirection="column">
        <box flexGrow={1} minHeight={1}>
          <text>conversation output</text>
        </box>
        <PendingInputPanel
          queuedFollowUps={[]}
          steering={["after you do all the fixes release it as 0.3.3"]}
          followUps={[]}
          onEditQueuedFollowUp={() => {}}
        />
        <textarea height={2} minHeight={2} />
      </box>
    ), 80, 10);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("steering: after you do all the fixes release it as 0.3.3");
    expect(frame).not.toContain("steering: after you do all the fixes release it as 0.3.3conversation");
  });

  test("renders separate parallel subagents and hides steering input for finished children", async () => {
    const run: SubagentRun = {
      runId: "parallel-run",
      asyncDir: "/tmp/parallel-run",
      mode: "parallel",
      state: "running",
      steps: [
        { index: 0, agent: "implementer", status: "running", sessionFile: "/tmp/impl.jsonl" },
        { index: 1, agent: "reviewer", status: "completed" },
      ],
    };
    const targets = subagentTargets([run]);
    const selector = await mount(() => (
      <SubagentSelectorDialog targets={targets} selectedKey={targets[0]?.key} onSelect={() => {}} onCancel={() => {}} />
    ), 90, 24);
    const selectorFrame = selector.captureCharFrame();
    expect(selectorFrame).toContain("implementer");
    expect(selectorFrame).toContain("reviewer");
    expect(selectorFrame).toContain("1 active");

    const finished = targets.find((target) => target.step?.agent === "reviewer")!;
    const inspector = await mount(() => <SubagentInspector target={finished} items={[]} now={2_000} />, 100, 24);
    const inspectorFrame = inspector.captureCharFrame();
    expect(inspectorFrame).toContain("Steering input hidden");
    expect(inspectorFrame).not.toContain("Steer reviewer #2");
  });

  test("collapses and expands thinking while keeping a visible preview", async () => {
    const item: ConversationItem = {
      kind: "assistant",
      id: "thinking-toggle",
      text: "Done.",
      thinking: `${"Inspect the files carefully and compare every relevant behavior. ".repeat(4)}\nUNIQUE_EXPANDED_DETAIL`,
      timestamp: 2,
      status: "done",
    };
    const collapsed = await mount(() => <MessageView item={item} showThinking thinkingExpanded={false} toolExpanded={false} />);
    const collapsedFrame = collapsed.captureCharFrame();
    expect(collapsedFrame).toContain("▶ Thinking");
    expect(collapsedFrame).toContain("Inspect the files carefully");
    expect(collapsedFrame).not.toContain("UNIQUE_EXPANDED_DETAIL");

    const expanded = await mount(() => <MessageView item={item} showThinking thinkingExpanded toolExpanded={false} />);
    const expandedFrame = expanded.captureCharFrame();
    expect(expandedFrame).toContain("▼ Thinking");
    expect(expandedFrame).toContain("UNIQUE_EXPANDED_DETAIL");
  });


  test("does not render a fake answer row when an assistant is only thinking", async () => {
    const item: ConversationItem = {
      kind: "assistant",
      id: "thinking-only",
      text: "",
      thinking: "Inspecting the branch state before changing anything.",
      timestamp: 2,
      status: "streaming",
    };
    const setup = await mount(() => <MessageView item={item} showThinking thinkingExpanded toolExpanded={false} />);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Thinking");
    expect(frame).toContain("Inspecting the branch state");
    expect(frame).not.toContain("▍");
  });

  test("filters and renders slash-command suggestions", async () => {
    const commands = [
      { name: "thinking", description: "Change reasoning effort", source: "ui" },
      { name: "thoughts", description: "Collapse thinking blocks", source: "ui" },
      { name: "model", description: "Select a model", source: "ui" },
    ];
    expect(filterCommandChoices(commands, "/th").map((item) => item.name)).toEqual(["thinking", "thoughts"]);
    expect(filterCommandChoices(commands, "/thinking high")).toEqual([]);
    const setup = await mount(() => (
      <CommandSuggestions commands={filterCommandChoices(commands, "/th")} selectedIndex={0} onSelect={() => {}} />
    ), 90, 12);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("/thinking");
    expect(frame).toContain("/thoughts");
    expect(frame).toContain("Tab insert");
  });

  test("derives active todos first and completed todos at the end", () => {
    const items: ConversationItem[] = [
      {
        kind: "tool",
        id: "todo-add-1",
        toolCallId: "todo-add-1",
        name: "todo",
        args: { action: "add", id: "1", text: "Inspect the RPC events", status: "in_progress" },
        output: "Created todo #1: Inspect the RPC events (in_progress)",
        timestamp: 1,
        status: "done",
        isError: false,
      },
      {
        kind: "tool",
        id: "todo-add-2",
        toolCallId: "todo-add-2",
        name: "todo",
        args: { action: "add", id: "2", text: "Add regression tests" },
        output: "Created todo #2: Add regression tests (pending)",
        timestamp: 2,
        status: "done",
        isError: false,
      },
      {
        kind: "tool",
        id: "todo-done-1",
        toolCallId: "todo-done-1",
        name: "todo",
        args: { action: "complete", id: "1" },
        output: "#1 -> completed",
        timestamp: 3,
        status: "done",
        isError: false,
      },
    ];
    const todos = deriveTodos(items);
    expect(todos.map((todo) => todo.id)).toEqual(["2", "1"]);
    expect(todos[0]?.done).toBe(false);
    expect(todos[1]?.done).toBe(true);
  });

  test("renders a request map for jumping to previous prompts", async () => {
    const setup = await mount(() => (
      <PromptMapDialog
        entries={[
          { id: "u1", text: "Inspect the authentication flow", timestamp: 1_700_000_000_000 },
          { id: "u2", text: "Now add regression tests", timestamp: 1_700_000_060_000 },
        ]}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ), 100, 24);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Your requests");
    expect(frame).toContain("Inspect the authentication flow");
    expect(frame).toContain("Now add regression tests");
  });

});

describe("duration and sidebar repaint regressions", () => {
  test("shows sub-second tool durations in milliseconds", async () => {
    const item: ConversationItem = {
      kind: "tool",
      id: "fast-tool",
      toolCallId: "fast-tool",
      name: "bash",
      args: { command: "true" },
      output: "done",
      timestamp: 1,
      startedAt: 1_000,
      endedAt: 1_347,
      status: "done",
      isError: false,
    };
    const setup = await mount(() => <MessageView item={item} showThinking toolExpanded={false} now={2_000} />);
    expect(setup.captureCharFrame()).toContain("took 347ms");
  });

  test("clips and sanitizes long subagent rows without stale suffixes", async () => {
    const run: SubagentRun = {
      runId: "run-long",
      asyncDir: "/tmp/run-long",
      mode: "parallel",
      state: "failed",
      agents: ["impl-check-logic", "impl-check-types", "impl-check-smell", "impl-check-architecture"],
      totalTokens: 231000,
      currentTool: "\u001b[31mbash\u001b[0m",
      currentPath: "/a/very/long/path/that/should/not/bleed/into/the/next/row.ts",
      steps: [],
    };
    const setup = await mount(() => <Sidebar runs={[run]} selectedRunId="run-long" now={2_000} />, 42, 28);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("impl-check-logic");
    expect(frame).toContain("failed");
    expect(frame).toContain("bash");
    expect(frame).not.toContain("\u001b");
    expect(frame).not.toContain("should/not/bleed/into/the/next/row.ts");
  });
});
