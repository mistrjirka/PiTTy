import { For, Show, type Accessor } from "solid-js";
import stripAnsi from "strip-ansi";
import type { RpcSessionState, SessionStats, SubagentRun, ToolItem } from "../types.ts";
import { subagentTargets, type SubagentTarget } from "../subagents/targets.ts";
import { formatDuration } from "./duration.ts";
import { colors } from "./theme.ts";
import { TodoPanel, type TodoViewItem } from "./todos.tsx";
import { appVersion } from "../version.ts";

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
  const activity = tool || path ? `${tool ?? "working"}${elapsed}${path ? ` · ${path}` : ""}` : "click to inspect";
  const lastUpdate = target.lastUpdate;
  const freshness = lastUpdate === undefined ? "last activity unknown" : `last activity ${formatDuration(Math.max(0, now - lastUpdate))} ago`;
  return `${activity} · ${freshness}`;
}

export function Sidebar(props: {
  state?: RpcSessionState | undefined;
  stats?: SessionStats | undefined;
  runs: SubagentRun[] | Accessor<SubagentRun[]>;
  tools?: ToolItem[] | Accessor<ToolItem[]> | undefined;
  selectedTargetKey?: string | undefined;
  selectedRunId?: string | undefined;
  now?: number | undefined;
  onSelectTarget?: ((targetKey: string) => void) | undefined;
  onInspectTarget?: ((targetKey: string) => void) | undefined;
  onSelectRun?: ((runId: string) => void) | undefined;
  onInspectRun?: ((runId: string) => void) | undefined;
  todos?: TodoViewItem[] | Accessor<TodoViewItem[]> | undefined;
  subagentsAvailable?: boolean | undefined;
  todosAvailable?: boolean | undefined;
  height?: number | Accessor<number> | undefined;
}) {
  const now = () => props.now ?? Date.now();
  const runs = () => typeof props.runs === "function" ? props.runs() : props.runs;
  const tools = () => typeof props.tools === "function" ? props.tools() : props.tools ?? [];
  const todos = () => typeof props.todos === "function" ? props.todos() : props.todos ?? [];
  const targets = () => subagentTargets(runs(), tools());
  const active = () => targets().filter((target) => target.active);
  const selectedKey = () => props.selectedTargetKey ?? targets().find((target) => target.run.runId === props.selectedRunId)?.key;
  const sidebarHeight = () => Math.max(1, (typeof props.height === "function" ? props.height() : props.height) ?? 40);
  const hasSubagents = () => props.subagentsAvailable !== false;
  const hasTodos = () => props.todosAvailable !== false && todos().length > 0;
  const fixedHeaderRows = () => 11 + (props.stats?.contextUsage?.percent !== undefined && props.stats?.contextUsage?.percent !== null ? 1 : 0);
  const availableBodyRows = () => Math.max(0, sidebarHeight() - fixedHeaderRows());
  const compactTargetHeight = () => targets().length
    ? targets().reduce((height, target) => height + (target.active ? 3 : 1), 1)
    : 0;
  const subagentHeight = () => {
    if (!hasTodos()) return undefined;
    const todoReserve = Math.min(6, Math.max(0, availableBodyRows() - 1));
    return Math.min(compactTargetHeight(), Math.max(0, availableBodyRows() - todoReserve));
  };
  const todoHeight = () => hasTodos() ? Math.max(0, availableBodyRows() - (subagentHeight() ?? 0)) : 0;

  const renderTarget = (target: SubagentTarget) => {
    const selected = () => target.key === selectedKey() || (!selectedKey() && target === targets()[0]);
    return (
      <box
        id={`subagent-${target.key}`}
        height={target.active ? 3 : 1}
        minHeight={target.active ? 3 : 1}
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
        <Show when={target.active} fallback={<text width="100%" height={1} fg={selected() ? colors.textBright : colors.text} attributes={selected() ? 1 : 0} wrapMode="none">{clip(`${target.label} · ${target.state}`, 31)}</text>}>
          <text width="100%" height={1} fg={selected() ? colors.textBright : colors.text} attributes={selected() ? 1 : 0} wrapMode="none">
            {clip(target.label, 31)}
          </text>
          <text width="100%" height={1} fg={colors.muted} wrapMode="none">
            {clip(`${target.state} · ${target.step?.turnCount ?? target.run.turnCount ?? 0}t/${target.step?.toolCount ?? target.run.toolCount ?? 0} tools · ${formatTokens(targetTokens(target))} tok`, 31)}
          </text>
          <text width="100%" height={1} fg={colors.subtle} wrapMode="none">{clip(targetActivity(target, now()), 31)}</text>
        </Show>
      </box>
    );
  };

  return (
    <box width={42} minWidth={42} height="100%" flexDirection="column" paddingLeft={2} paddingRight={1}>
      <text width="100%" height={1} fg={colors.textBright} attributes={1}>Session</text>
      <text width="100%" height={1} fg={colors.muted} wrapMode="none">
        {clip(props.state?.sessionName ?? props.state?.sessionId ?? "starting…")}
      </text>
      <text width="100%" height={1} fg={colors.subtle} wrapMode="none">PiTTy v{appVersion}</text>
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

      {
        // OpenTUI's runtime supports accessor children, but its BoxProps type
        // currently omits them. The accessor keeps layout reactive without
        // rebuilding the sidebar on a timer.
        // @ts-expect-error Accessor children are supported by the JSX runtime.
        () => (
        <>
          <Show when={hasSubagents()}>
            <box
              id="subagent-panel"
              flexGrow={hasTodos() ? 0 : 1}
              minHeight={Math.min(2, hasTodos() ? subagentHeight() ?? 0 : availableBodyRows())}
              flexShrink={1}
              flexDirection="column"
              {...(hasTodos() ? { height: subagentHeight() ?? 0 } : {})}
            >
              <box height={1} minHeight={1} flexShrink={0} flexDirection="row">
                <text fg={colors.textBright} attributes={1}>Subagents ({active().length} active)</text>
                <box flexGrow={1} />
                <Show when={targets().length > 0}>
                  <text fg={colors.subtle}>Ctrl+I · Ctrl+Down inspect{targets().length > 1 ? " · Ctrl+←/→ cycle" : ""}</text>
                </Show>
              </box>
              <scrollbox
                id="subagent-scroll"
                flexGrow={1}
                minHeight={1}
                scrollY
                scrollX={false}
                viewportCulling={true}
                verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background } }}
                onMouseScroll={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <Show when={targets().length > 0} fallback={<text width="100%" height={1} fg={colors.muted}>No async subagents for this session</text>}>
                  <For each={targets()}>{renderTarget}</For>
                </Show>
              </scrollbox>
            </box>
          </Show>

          <Show when={hasTodos()}>
            <box id="todo-panel" height={todoHeight()} minHeight={Math.min(6, todoHeight())} flexShrink={1}>
              <TodoPanel todos={todos()} height={todoHeight()} />
            </box>
          </Show>
        </>
        )
      }
    </box>
  );
}
