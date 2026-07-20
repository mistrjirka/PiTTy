import { createEffect, For, onCleanup, type Accessor } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { colors } from "./theme.ts";

export type CommandChoice = {
  name: string;
  description?: string | undefined;
  source?: string | undefined;
};

function clip(value: string, width = 86): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= width ? clean : `${clean.slice(0, width - 1)}…`;
}

export function selectCommandChoice(commands: CommandChoice[], index: number): CommandChoice | undefined {
  if (commands.length === 0) return undefined;
  const clampedIndex = Math.max(0, Math.min(index, commands.length - 1));
  return commands[clampedIndex];
}

export function filterCommandChoices(commands: CommandChoice[], input: string, limit = 7): CommandChoice[] {
  const match = input.match(/^\/([^\s]*)$/);
  if (!match) return [];
  const query = (match[1] ?? "").toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().startsWith(query))
    .sort((a, b) => {
      const aExact = a.name.toLowerCase() === query ? 0 : 1;
      const bExact = b.name.toLowerCase() === query ? 0 : 1;
      return aExact - bExact || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export type CommandSuggestionsProps = {
  commands: Accessor<readonly CommandChoice[]>;
  selectedIndex: Accessor<number>;
  onSelect: (command: CommandChoice) => void;
};

export function CommandSuggestions(props: CommandSuggestionsProps) {
  let suggestionsScroll: ScrollBoxRenderable | undefined;
  let ensureScheduled = false;
  let disposed = false;

  const ensureSelectedVisible = () => {
    if (disposed || !suggestionsScroll) return;
    const index = props.selectedIndex();
    const commands = props.commands();
    if (index < 0 || index >= commands.length) return;
    const rowTop = index;
    const rowBottom = index + 1;
    const scrollTop = suggestionsScroll.scrollTop;
    const height = suggestionsScroll.viewport.height;
    if (height <= 0 || rowTop >= scrollTop && rowBottom <= scrollTop + height) return;
    const maxTop = Math.max(0, suggestionsScroll.scrollHeight - height);
    const target = rowTop < scrollTop ? rowTop : rowBottom - height;
    const clampedTarget = Math.max(0, Math.min(target, maxTop));
    suggestionsScroll.scrollTo(clampedTarget);
  };

  const scheduleEnsureSelectedVisible = () => {
    if (disposed || ensureScheduled) return;
    ensureScheduled = true;
    setTimeout(() => {
      ensureScheduled = false;
      ensureSelectedVisible();
    }, 0);
  };

  createEffect(() => {
    props.selectedIndex();
    props.commands().length;
    scheduleEnsureSelectedVisible();
  });

  onCleanup(() => {
    disposed = true;
  });

  return (
    <box
      flexDirection="column"
      maxHeight={8}
      minHeight={2}
      flexShrink={1}
      backgroundColor={colors.panelRaised}
      border={["top", "left", "right"]}
      borderColor={colors.borderStrong}
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={1} minHeight={1} flexShrink={0} flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Commands</text>
        <box flexGrow={1} />
        <text fg={colors.subtle}>↑/↓ choose · Tab/Enter insert</text>
      </box>
      <scrollbox
        ref={(value) => { suggestionsScroll = value; }}
        flexGrow={1}
        minHeight={0}
        flexShrink={1}
        maxHeight={6}
        focusable={false}
        scrollY
        scrollX={false}
        viewportCulling={true}
        verticalScrollbarOptions={{ showArrows: false, trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background } }}
        onSizeChange={scheduleEnsureSelectedVisible}
        onMouseScroll={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
      <For each={props.commands()}>
        {(command, index) => {
          const selected = () => index() === props.selectedIndex();
          return (
            <box
              id={`command-suggestion-row-${index()}`}
              height={1}
              minHeight={1}
              flexShrink={0}
              flexDirection="row"
              backgroundColor={selected() ? colors.selection : colors.panelRaised}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onSelect(command);
              }}
            >
              <text width={24} fg={selected() ? colors.textBright : colors.cyan} wrapMode="none">/{command.name}</text>
              <text flexGrow={1} fg={selected() ? colors.text : colors.muted} wrapMode="none">{clip(command.description ?? command.source ?? "")}</text>
            </box>
          );
        }}
      </For>
      </scrollbox>
    </box>
  );
}
