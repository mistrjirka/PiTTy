import { For } from "solid-js";
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

export function CommandSuggestions(props: {
  commands: CommandChoice[];
  selectedIndex: number;
  onSelect: (command: CommandChoice) => void;
}) {
  return (
    <box
      flexDirection="column"
      backgroundColor={colors.panelRaised}
      border={["top", "left", "right"]}
      borderColor={colors.borderStrong}
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={1} minHeight={1} flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Commands</text>
        <box flexGrow={1} />
        <text fg={colors.subtle}>↑/↓ choose · Tab/Enter insert</text>
      </box>
      <For each={props.commands}>
        {(command, index) => {
          const selected = () => index() === props.selectedIndex;
          return (
            <box
              height={1}
              minHeight={1}
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
    </box>
  );
}
