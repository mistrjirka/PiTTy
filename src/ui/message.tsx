import { For, Show } from "solid-js";
import stripAnsi from "strip-ansi";
import type { ConversationItem, ToolItem } from "../types.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import { colors, markdownStyle, thinkingMarkdownStyle } from "./theme.ts";
import { formatDuration } from "./duration.ts";


function toolVisual(name: string, isError: boolean): { accent: string; background: string; icon: string } {
  if (isError) return { accent: colors.red, background: colors.toolOtherBg, icon: "×" };
  const normalized = name.toLowerCase();
  if (/write|edit|patch|replace/.test(normalized)) return { accent: colors.green, background: colors.toolWriteBg, icon: "◆" };
  if (/bash|shell|exec|command|terminal/.test(normalized)) return { accent: colors.orange, background: colors.toolShellBg, icon: "▣" };
  if (/subagent|task|agent|delegate/.test(normalized)) return { accent: colors.purple, background: colors.toolAgentBg, icon: "◇" };
  if (/read|grep|find|search|list|glob|web|fetch/.test(normalized)) return { accent: colors.accent, background: colors.toolReadBg, icon: "●" };
  return { accent: colors.cyan, background: colors.toolOtherBg, icon: "●" };
}

export function cleanTerminalText(value: string): string {
  return stripAnsi(value)
    // A few transcript writers persist the CSI body after losing the ESC byte.
    // Remove only numeric ANSI color/cursor fragments, not ordinary bracketed text.
    .replace(/\[(?:\d{1,3};)+\d{0,3}[mGKHFJ]/g, "")
    .replace(/\[\d{1,3}[mGKHFJ]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function diffLines(value: string): string[] {
  return cleanTerminalText(value).trimEnd().split(/\r?\n/);
}

function diffStats(value: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diffLines(value)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function diffLineColor(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return colors.muted;
  if (line.startsWith("+")) return colors.green;
  if (line.startsWith("-")) return colors.red;
  if (line.startsWith("@@")) return colors.cyan;
  if (line.startsWith("diff ") || line.startsWith("Index:")) return colors.purple;
  return colors.text;
}

function expandedDiffHeight(value: string): number {
  return Math.max(6, Math.min(22, diffLines(value).length));
}

function prettyArgs(args: unknown): string {
  if (args === undefined) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function expandedToolHeight(output: string): number {
  return Math.max(6, Math.min(18, output.split("\n").length + 1));
}

export function toolOutputExpandable(output: string): boolean {
  const clean = cleanTerminalText(output).trimEnd();
  if (!clean) return false;
  const lines = clean.split("\n");
  return lines.length > 4 || clean.length > 320 || lines.some((line) => line.length > 180);
}

function collapsedPreview(output: string): string {
  const normalized = cleanTerminalText(output).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 220 ? `${normalized.slice(0, 217)}…` : normalized;
}


export function cleanThinkingText(value: string): string {
  let result = cleanTerminalText(value).trimStart();
  // Some providers include their own “Thinking” heading. Strip every leading
  // copy so the UI heading is shown exactly once. Only strip an actual heading
  // (a colon or newline must follow), not normal prose such as “Thinking about…”.
  for (let index = 0; index < 4; index++) {
    const next = result
      .replace(/^\s*(?:[>|#*_`-]+\s*)*(?:thinking|reasoning)\s*(?::\s*|\r?\n\s*)/i, "")
      .trimStart();
    if (next === result) break;
    result = next;
  }
  return result;
}

function cleanAnswerText(value: string): string {
  return cleanTerminalText(value).trimStart();
}

function thinkingLineCount(value: string): number {
  const clean = value.trim();
  return clean ? clean.split(/\r?\n/).length : 0;
}

function collapsedThinkingPreview(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
}

function toolTiming(item: ToolItem, now: number): string {
  const startedAt = item.startedAt;
  if (startedAt === undefined) return item.timeoutMs ? `timeout ${formatDuration(item.timeoutMs, "")}` : "";
  const elapsed = Math.max(0, (item.endedAt ?? now) - startedAt);
  const duration = formatDuration(elapsed, "");
  const timeout = formatDuration(item.timeoutMs, "");
  if (item.status === "streaming" || item.status === "pending") {
    return `${duration}${timeout ? ` / timeout ${timeout}` : ""}`;
  }
  return duration ? `took ${duration}${timeout ? ` · timeout ${timeout}` : ""}` : timeout ? `timeout ${timeout}` : "";
}

export function MessageView(props: {
  item: ConversationItem;
  showThinking: boolean;
  thinkingExpanded?: boolean;
  onToggleThinking?: () => void;
  toolExpanded: boolean;
  onToggleTool?: (toolId: string) => void;
  diffExpanded?: boolean;
  onToggleDiff?: (toolId: string) => void;
  subagentTargets?: SubagentTarget[] | undefined;
  onInspectSubagentTarget?: ((targetKey: string) => void) | undefined;
  now?: number;
}) {
  const thinking = () => props.item.kind === "assistant" ? cleanThinkingText(props.item.thinking) : "";
  const answer = () => props.item.kind === "assistant" ? cleanAnswerText(props.item.text) : "";
  return (
    <>
      <Show when={props.item.kind === "user"}>
        <box
          id={props.item.id}
          backgroundColor={colors.panelRaised}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          marginBottom={1}
          border={["left"]}
          borderColor={colors.accent}
        >
          <text fg={colors.textBright} selectable wrapMode="word">
            {(props.item.kind === "user" ? props.item.text : "") + (props.item.kind === "user" && props.item.optimistic ? "  …" : "")}
          </text>
        </box>
      </Show>

      <Show when={props.item.kind === "assistant"}>
        <box
          id={props.item.id}
          flexDirection="column"
          marginBottom={1}
          paddingLeft={1}
          paddingRight={1}
          border={["left"]}
          borderColor={colors.cyan}
        >
          <Show when={props.showThinking && thinking().trim()}>
            <box flexDirection="column" marginBottom={answer().trim() ? 1 : 0} paddingLeft={1} backgroundColor={colors.thinkingBg}>
              <box
                flexDirection="row"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onToggleThinking?.();
                }}
              >
                <text fg={colors.purple} attributes={1}>{props.thinkingExpanded === false ? "▶ Thinking" : "▼ Thinking"}</text>
                <box flexGrow={1} />
                <text fg={colors.subtle}>{thinkingLineCount(thinking())} line{thinkingLineCount(thinking()) === 1 ? "" : "s"} · click</text>
              </box>
              <Show
                when={props.thinkingExpanded !== false}
                fallback={<text fg={colors.subtle} selectable wrapMode="none">{collapsedThinkingPreview(thinking())}</text>}
              >
                <markdown
                  content={thinking()}
                  syntaxStyle={thinkingMarkdownStyle}
                  fg={colors.muted}
                  conceal
                  streaming
                  tableOptions={{ style: "columns", wrapMode: "word", selectable: true }}
                />
              </Show>
            </box>
          </Show>
          <Show when={props.item.kind === "assistant" && (answer().trim() || (props.item.status === "streaming" && !thinking().trim()))}>
            <Show
              when={props.item.kind === "assistant" && props.item.status !== "streaming"}
              fallback={
                // Streaming Markdown frequently contains incomplete fences and
                // emphasis markers. Plain text prevents the grey truncation and
                // stale-cell overlaps seen while a response is still arriving.
                <text fg={colors.textBright} selectable wrapMode="word">{answer() || "▍"}</text>
              }
            >
              <markdown
                content={answer() || "▍"}
                syntaxStyle={markdownStyle}
                fg={colors.textBright}
                conceal
                streaming
                tableOptions={{ style: "columns", wrapMode: "word", selectable: true }}
              />
            </Show>
          </Show>
        </box>
      </Show>

      <Show when={props.item.kind === "tool"}>
        {(() => {
          const output = () => props.item.kind === "tool" ? props.item.output : "";
          const diff = () => props.item.kind === "tool" ? props.item.diff ?? "" : "";
          const expandable = () => Boolean(output() && toolOutputExpandable(output()));
          const expanded = () => expandable() && props.toolExpanded;
          const visual = () => props.item.kind === "tool" ? toolVisual(props.item.name, props.item.isError) : toolVisual("tool", false);
          const stats = () => diffStats(diff());
          return (
            <box
              id={props.item.id}
              flexDirection="column"
              backgroundColor={expanded() ? colors.panelRaised : visual().background}
              border={["left"]}
              borderColor={visual().accent}
              paddingLeft={1}
              paddingRight={1}
              marginBottom={1}
            >
              <box
                flexDirection="row"
                onMouseDown={(event) => {
                  if (!expandable()) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.item.kind === "tool") props.onToggleTool?.(props.item.id);
                }}
              >
                <text fg={visual().accent} attributes={1}>
                  {props.item.kind === "tool"
                    ? `${expandable() ? (expanded() ? "▼ " : "▶ ") : ""}${props.item.status === "streaming" ? "◉" : visual().icon} TOOL · ${props.item.name}`
                    : ""}
                </text>
                <Show when={props.item.kind === "tool" && props.item.args !== undefined}>
                  <text fg={colors.muted} selectable wrapMode="word">
                    {props.item.kind === "tool" ? `  ${prettyArgs(props.item.args).replace(/\s+/g, " ").slice(0, 150)}` : ""}
                  </text>
                </Show>
                <box flexGrow={1} />
                <Show when={props.item.kind === "tool" && toolTiming(props.item, props.now ?? Date.now())}>
                  <text fg={colors.subtle}>{props.item.kind === "tool" ? toolTiming(props.item, props.now ?? Date.now()) : ""}</text>
                </Show>
              </box>
              <Show when={(props.subagentTargets?.length ?? 0) > 0}>
                <box flexDirection="column" marginTop={1} border={["top"]} borderColor={colors.borderStrong} paddingTop={1}>
                  <text fg={colors.purple} attributes={1}>Subagents</text>
                  <For each={props.subagentTargets ?? []}>
                    {(target) => (
                      <box
                        height={2}
                        minHeight={2}
                        flexShrink={0}
                        flexDirection="column"
                        paddingLeft={1}
                        border={["left"]}
                        borderColor={target.active ? colors.green : target.state === "failed" ? colors.red : colors.borderStrong}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onInspectSubagentTarget?.(target.key);
                        }}
                      >
                        <box height={1} flexDirection="row">
                          <text fg={target.active ? colors.textBright : colors.text} attributes={target.active ? 1 : 0} wrapMode="none">
                            {target.active ? "●" : "○"} {target.label}
                          </text>
                          <box flexGrow={1} />
                          <text fg={colors.cyan}>inspect</text>
                        </box>
                        <text height={1} fg={colors.muted} wrapMode="none">{target.state} · {target.run.mode}</text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>
              <Show when={output()}>
                <Show
                  when={expandable()}
                  fallback={
                    <text fg={colors.muted} selectable wrapMode="word">
                      {cleanTerminalText(output())}
                    </text>
                  }
                >
                  <Show
                    when={expanded()}
                    fallback={
                      <box flexDirection="row">
                        <text fg={colors.subtle} wrapMode="none">{collapsedPreview(output())}</text>
                        <box flexGrow={1} />
                        <text fg={colors.subtle}>click to expand</text>
                      </box>
                    }
                  >
                    <scrollbox
                      height={expandedToolHeight(output())}
                      minHeight={6}
                      scrollY
                      scrollX={false}
                      stickyScroll
                      stickyStart="bottom"
                      viewportCulling={false}
                      onMouseScroll={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      verticalScrollbarOptions={{ showArrows: false }}
                    >
                      <text fg={colors.muted} selectable wrapMode="word">
                        {cleanTerminalText(output())}
                      </text>
                    </scrollbox>
                  </Show>
                </Show>
              </Show>
              <Show when={diff().trim()}>
                <box flexDirection="column" marginTop={1} border={["top"]} borderColor={colors.borderStrong} paddingTop={1}>
                  <box
                    flexDirection="row"
                    onMouseUp={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (props.item.kind === "tool") props.onToggleDiff?.(props.item.id);
                    }}
                  >
                    <text fg={colors.green} attributes={1}>{props.diffExpanded ? "▼" : "▶"} Changes</text>
                    <text fg={colors.green}>  +{stats().additions}</text>
                    <text fg={colors.red}>  -{stats().deletions}</text>
                    <Show when={props.item.kind === "tool" && props.item.diffPath}>
                      <text fg={colors.muted}>  {props.item.kind === "tool" ? props.item.diffPath ?? "" : ""}</text>
                    </Show>
                    <box flexGrow={1} />
                    <text fg={colors.subtle}>{props.diffExpanded ? "click to collapse" : "click to view diff"}</text>
                  </box>
                  <Show when={props.diffExpanded}>
                    <scrollbox
                      height={expandedDiffHeight(diff())}
                      minHeight={6}
                      scrollY
                      scrollX={false}
                      viewportCulling={false}
                      backgroundColor={colors.diffBg}
                      onMouseScroll={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      verticalScrollbarOptions={{ showArrows: false }}
                    >
                      <For each={diffLines(diff())}>
                        {(line) => <text fg={diffLineColor(line)} selectable wrapMode="none">{line || " "}</text>}
                      </For>
                    </scrollbox>
                  </Show>
                </box>
              </Show>
            </box>
          );
        })()}
      </Show>

      <Show when={props.item.kind === "system"}>
        <box id={props.item.id} paddingLeft={1} marginBottom={1}>
          <text
            selectable
            wrapMode="word"
            fg={
              props.item.kind !== "system"
                ? colors.muted
                : props.item.tone === "error"
                  ? colors.red
                  : props.item.tone === "warning"
                    ? colors.yellow
                    : props.item.tone === "success"
                      ? colors.green
                      : props.item.tone === "info"
                        ? colors.cyan
                        : colors.muted
            }
          >
            {props.item.kind === "system" ? `· ${cleanTerminalText(props.item.text)}` : ""}
          </text>
        </box>
      </Show>
    </>
  );
}
