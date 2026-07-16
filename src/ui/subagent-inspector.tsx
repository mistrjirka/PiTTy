import { For, Show } from "solid-js";
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { ConversationItem, SubagentRun } from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
import { colors } from "./theme.ts";
import { formatDuration } from "./duration.ts";
import { formatContextWindow } from "./model-selector.tsx";
import { MessageView } from "./message.tsx";

export function SubagentInspector(props: {
  target?: SubagentTarget | undefined;
  run?: SubagentRun | undefined;
  items: ConversationItem[];
  now: number;
  scrollRef?: (value: ScrollBoxRenderable) => void;
  onClose?: () => void;
  onChooseTarget?: () => void;
  onSteer?: (message: string) => void;
  thinkingExpanded?: (itemId: string) => boolean;
  onToggleThinking?: (itemId: string) => void;
  toolExpanded?: (toolId: string) => boolean;
  onToggleTool?: (toolId: string) => void;
  diffExpanded?: (toolId: string) => boolean;
  onToggleDiff?: (toolId: string) => void;
}) {
  const target = () => (props.target ?? (props.run ? subagentTargets([props.run])[0] : undefined))!;
  const run = () => target().run;
  const step = () => target().step;
  const elapsed = () => target().startedAt
    ? (step()?.endedAt ?? run().endedAt ?? props.now) - target().startedAt!
    : undefined;
  const toolStartedAt = () => step()?.currentToolStartedAt ?? run().currentToolStartedAt;
  const toolElapsed = () => toolStartedAt() ? props.now - toolStartedAt()! : undefined;
  const currentTool = () => step()?.currentTool ?? run().currentTool;
  const currentPath = () => step()?.currentPath ?? run().currentPath;
  const timeoutMs = () => step()?.timeoutMs ?? run().timeoutMs;
  const deadlineAt = () => step()?.deadlineAt ?? run().deadlineAt;
  const remaining = () => deadlineAt() ? deadlineAt()! - props.now : undefined;
  let closePending = false;
  let steerEditor: TextareaRenderable | undefined;

  const requestClose = (event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (closePending) return;
    closePending = true;
    props.onClose?.();
  };

  const sendSteer = () => {
    const message = steerEditor?.plainText.trim() ?? "";
    if (!message) return;
    props.onSteer?.(message);
    steerEditor?.setText("");
  };

  return (
    <box flexGrow={1} minHeight={1} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <box
        flexDirection="column"
        flexShrink={0}
        border={["bottom"]}
        borderColor={colors.borderStrong}
        paddingBottom={1}
        marginBottom={1}
      >
        <box height={1} minHeight={1} flexShrink={0} flexDirection="row" zIndex={10}>
          <text height={1} wrapMode="none" fg={colors.textBright} attributes={1}>Subagent detail</text>
          <box flexGrow={1} height={1} />
          <text
            id="subagent-inspector-choose"
            fg={colors.purple}
            attributes={1}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onChooseTarget?.();
            }}
          >{target().label} ▼</text>
          <text
            id="subagent-inspector-close"
            fg={colors.cyan}
            attributes={1}
            marginLeft={2}
            onMouseDown={requestClose}
          >← Main chat</text>
        </box>
        <text height={1} minHeight={1} flexShrink={0} wrapMode="none" fg={colors.subtle}>
          Click the agent name to switch · Esc / Ctrl+I close · F6 next
        </text>
        <text fg={colors.muted} wrapMode="word">
          {run().mode} · {target().state} · {formatDuration(elapsed())}
          {timeoutMs() ? ` / timeout ${formatDuration(timeoutMs())}` : ""}
          {remaining() !== undefined && target().active ? ` · ${formatDuration(Math.max(0, remaining()!))} left` : ""}
        </text>
        <Show when={currentTool() || currentPath()}>
          <text fg={colors.cyan} wrapMode="word">
            {currentTool() ?? "working"}{toolElapsed() !== undefined ? ` ${formatDuration(toolElapsed())}` : ""}
            {currentPath() ? ` · ${currentPath()}` : ""}
          </text>
        </Show>
        {(() => {
          const currentStep = step();
          return (
            <text fg={colors.muted} wrapMode="word">
              {currentStep ? `child ${currentStep.index + 1} · ${currentStep.agent} · ${currentStep.status}` : `${target().label} · ${target().state}`}
              {` · model ${target().model ?? "unknown"}`}
              {` · ${formatContextWindow(target().contextWindow) || "context unknown"}`}
              {` · thinking ${target().thinking ?? "unknown"}`}
            </text>
          );
        })()}
      </box>
      <scrollbox
        ref={(value) => props.scrollRef?.(value)}
        flexGrow={1}
        minHeight={1}
        scrollY
        scrollX={false}
        stickyScroll
        stickyStart="bottom"
        viewportCulling={false}
        verticalScrollbarOptions={{ showArrows: false }}
      >
        <Show when={props.items.length === 0}>
          <text fg={colors.muted}>No transcript has been written for this subagent yet.</text>
        </Show>
        <For each={props.items}>
          {(item) => (
            <MessageView
              item={item}
              showThinking
              thinkingExpanded={props.thinkingExpanded?.(item.id) ?? true}
              onToggleThinking={() => props.onToggleThinking?.(item.id)}
              toolExpanded={item.kind === "tool" ? props.toolExpanded?.(item.id) ?? false : false}
              {...(props.onToggleTool ? { onToggleTool: props.onToggleTool } : {})}
              diffExpanded={item.kind === "tool" ? props.diffExpanded?.(item.id) ?? false : false}
              {...(props.onToggleDiff ? { onToggleDiff: props.onToggleDiff } : {})}
              now={item.kind === "tool" && (item.status === "streaming" || item.status === "pending")
                ? props.now
                : item.kind === "tool"
                  ? item.endedAt ?? item.startedAt ?? item.timestamp
                  : 0}
            />
          )}
        </For>
      </scrollbox>
      <Show when={target().canSteer}>
        <box
          flexShrink={0}
          border={["top"]}
          borderColor={colors.purple}
          backgroundColor={colors.panel}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          minHeight={4}
          maxHeight={9}
        >
          <textarea
            ref={(value) => { steerEditor = value; }}
            focused
            placeholder={`Steer ${target().label}…`}
            wrapMode="word"
            backgroundColor={colors.panel}
            focusedBackgroundColor={colors.panel}
            textColor={colors.textBright}
            focusedTextColor={colors.textBright}
            placeholderColor={colors.muted}
            selectionBg={colors.selection}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "enter", action: "submit" },
              { name: "kpenter", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "enter", shift: true, action: "newline" },
              { name: "kpenter", shift: true, action: "newline" },
            ]}
            minHeight={2}
            maxHeight={7}
            onSubmit={sendSteer}
          />
        </box>
      </Show>
      <Show when={!target().canSteer}>
        <box height={3} minHeight={3} flexShrink={0} border={["top"]} borderColor={colors.borderStrong} paddingTop={1} paddingLeft={1}>
          <text fg={colors.subtle} wrapMode="none">Steering input hidden: this child is finished or has no live steerable Pi session.</text>
        </box>
      </Show>
    </box>
  );
}
