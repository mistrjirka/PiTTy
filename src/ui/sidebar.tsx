import { For, Show } from "solid-js";
import stripAnsi from "strip-ansi";
import type { RpcSessionState, SessionStats, SubagentRun } from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
import { formatDuration } from "./duration.ts";
import { colors } from "./theme.ts";
import { TodoPanel, type TodoViewItem } from "./todos.tsx";

const CONTENT_WIDTH = 36;

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function cleanInline(value: string): string {
  return stripAnsi(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, width = CONTENT_WIDTH): string {
  const clean = cleanInline(value);
  if (clean.length <= width) return clean;
  return `${clean.slice(0, Math.max(1, width - 1))}…`;
}

function stateColor(state: string): string {
  if (["running", "active", "working"].includes(state)) return colors.green;
  if (["queued", "paused", "needs_attention"].includes(state)) return colors.yellow;
  if (["failed", "error", "timed_out"].includes(state)) return colors.red;
  return colors.borderStrong;
}

function targetTokens(target: SubagentTarget): number | undefined {
  return target.step?.tokens?.total ?? (target.run.steps.length <= 1 ? target.run.totalTokens : undefined);
}

function targetActivity(target: SubagentTarget, now: number): string {
  const tool = target.step?.currentTool ?? target.run.currentTool;
  const startedAt = target.step?.currentToolStartedAt ?? target.run.currentToolStartedAt;
  const elapsed = startedAt ? ` ${formatDuration(now - startedAt)}` : "";
  const path = target.step?.currentPath ?? target.run.currentPath;
  return tool || path ? `${tool ?? "working"}${elapsed}${path ? ` · ${path}` : ""}` : "click to inspect";
}

export function Sidebar(props: {
  state?: RpcSessionState | undefined;
  stats?: SessionStats | undefined;
  runs: SubagentRun[];
  selectedTargetKey?: string | undefined;
  selectedRunId?: string | undefined;
  now?: number | undefined;
  onSelectTarget?: ((targetKey: string) => void) | undefined;
  onInspectTarget?: ((targetKey: string) => void) | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onInspectRun?: ((runId: string) => void) | undefined;
  todos?: TodoViewItem[] | undefined;
  subagentsAvailable?: boolean | undefined;
  todosAvailable?: boolean | undefined;
  height?: number | undefined;
}) {
  const now = () => props.now ?? Date.now();
  const targets = () => subagentTargets(props.runs);
  const active = () => targets().filter((target) => target.active);
  const finished = () => targets().filter((target) => !target.active);
  const selectedKey = () => props.selectedTargetKey ?? targets().find((target) => target.run.runId === props.selectedRunId)?.key;
  const current = () => targets().find((target) => target.key === selectedKey()) ?? targets()[0];
  const sidebarHeight = () => Math.max(24, props.height ?? 40);
  const hasSubagents = () => props.subagentsAvailable !== false;
  const hasTodos = () => props.todosAvailable !== false && (props.todos?.length ?? 0) > 0;
  const todoHeight = () => hasTodos() ? Math.max(7, Math.min(16, Math.floor(sidebarHeight() * 0.3))) : 0;
  const subagentHeight = () => hasSubagents() ? Math.max(8, sidebarHeight() - todoHeight() - (hasTodos() ? 15 : 13)) : 0;

  const renderTarget = (target: SubagentTarget) => {
    const selected = () => target.key === selectedKey() || (!selectedKey() && target === targets()[0]);
    return (
      <box
        id={`subagent-${target.key}`}
        height={3}
        minHeight={3}
        flexShrink={0}
        flexDirection="column"
        paddingLeft={1}
        border={["left"]}
        borderColor={stateColor(target.step?.activityState ?? target.state)}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onSelectTarget?.(target.key);
          props.onSelectRun?.(target.run.runId);
          props.onInspectTarget?.(target.key);
          props.onInspectRun?.(target.run.runId);
        }}
      >
        <text width="100%" height={1} fg={selected() ? colors.textBright : colors.text} attributes={selected() ? 1 : 0} wrapMode="none">
          {clip(target.label, 31)}
        </text>
        <text width="100%" height={1} fg={colors.muted} wrapMode="none">
          {clip(`${target.state} · ${target.step?.turnCount ?? target.run.turnCount ?? 0}t/${target.step?.toolCount ?? target.run.toolCount ?? 0} tools · ${formatTokens(targetTokens(target))} tok`, 31)}
        </text>
        <text width="100%" height={1} fg={colors.subtle} wrapMode="none">{clip(targetActivity(target, now()), 31)}</text>
      </box>
    );
  };

  return (
    <box width={42} minWidth={42} height="100%" flexDirection="column" paddingLeft={2} paddingRight={1}>
      <text width="100%" height={1} fg={colors.textBright} attributes={1}>Session</text>
      <text width="100%" height={1} fg={colors.muted} wrapMode="none">
        {clip(props.state?.sessionName ?? props.state?.sessionId ?? "starting…")}
      </text>
      <box height={1} />
      <text width="100%" height={1} fg={colors.textBright} attributes={1}>Context</text>
      <text width="100%" height={1} fg={colors.muted} wrapMode="none">
        {clip(`${formatTokens(props.stats?.contextUsage?.tokens ?? undefined)} / ${formatTokens(props.stats?.contextUsage?.contextWindow ?? props.state?.model?.contextWindow)}`)}
      </text>
      <Show when={props.stats?.contextUsage?.percent !== undefined && props.stats?.contextUsage?.percent !== null}>
        <text width="100%" height={1} fg={colors.muted}>{Math.round(props.stats?.contextUsage?.percent ?? 0)}% used</text>
      </Show>
      <box height={1} />
      <text width="100%" height={1} fg={colors.textBright} attributes={1}>Model</text>
      <text width="100%" height={1} fg={colors.muted} wrapMode="none">
        {clip(props.state?.model ? `${props.state.model.provider}/${props.state.model.id}` : "—")}
      </text>
      <text width="100%" height={1} fg={colors.muted}>Thinking: {clip(props.state?.thinkingLevel ?? "—")}</text>
      <box height={1} />

      <Show when={hasSubagents()}>
        <box height={1} minHeight={1} flexDirection="row">
          <text fg={colors.textBright} attributes={1}>Subagents ({active().length} active)</text>
          <box flexGrow={1} />
          <text fg={colors.subtle}>F6</text>
        </box>
        <scrollbox
        height={subagentHeight()}
        minHeight={8}
        scrollY
        scrollX={false}
        viewportCulling={false}
        verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background } }}
        onMouseScroll={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Show when={targets().length > 0} fallback={<text width="100%" height={1} fg={colors.muted}>No async subagents for this session</text>}>
          <Show when={active().length}>
            <text width="100%" height={1} fg={colors.green} attributes={1}>Active</text>
            <For each={active()}>{renderTarget}</For>
          </Show>
          <Show when={finished().length}>
            <box height={1} minHeight={1} marginTop={1}><text fg={colors.subtle} attributes={1}>Finished</text></box>
            <For each={finished()}>{renderTarget}</For>
          </Show>
          <Show when={current()}>
            {(selected) => (
              <box flexDirection="column" marginTop={1} border={["top"]} borderColor={colors.borderStrong} paddingTop={1}>
                <text width="100%" height={1} fg={colors.textBright} attributes={1}>Selected</text>
                <text width="100%" height={1} fg={colors.muted} wrapMode="none">{clip(`${selected().label} · ${selected().run.mode}`)}</text>
                <text width="100%" height={1} fg={selected().canSteer ? colors.green : colors.subtle} wrapMode="none">
                  {selected().canSteer ? "live steering available" : "read-only / finished"}
                </text>
              </box>
            )}
          </Show>
        </Show>
        </scrollbox>
        <text width="100%" height={1} fg={colors.subtle} wrapMode="none">Ctrl+I inspect · Ctrl+A pause · Ctrl+Shift+A stop</text>
      </Show>

      <Show when={hasTodos()}>
        <TodoPanel todos={props.todos ?? []} height={todoHeight()} />
      </Show>
    </box>
  );
}
