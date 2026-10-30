import type { SelectRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { ClaudeAccountChoice, CswapAccount } from "../integrations/claude-swap.ts";
import { colors } from "./theme.ts";

export function ClaudeAccountSelector(props: {
  accounts: CswapAccount[];
  selection: ClaudeAccountChoice;
  effectiveSlot?: number | undefined;
  onSelect: (choice: ClaudeAccountChoice) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const choices = createMemo(() => [
    { name: "Automatic (current Pi account)", description: "Follow the account used by Pi", value: "auto" },
    ...props.accounts.map((account) => ({
      name: `${account.label} (slot ${account.number})`,
      description: account.usage?.limits.map((limit) => `${limit.label} ${Math.round(limit.percent)}%`).join(" · ") || account.usageStatus,
      value: String(account.number),
    })),
  ]);
  createEffect(() => {
    if (!select) return;
    select.options = choices();
    select.selectedIndex = Math.max(0, choices().findIndex((c) => c.value === String(props.selection)));
  });
  const choose = (value: unknown) => {
    if (typeof value !== "string") return;
    const next = value === "auto" ? "auto" : Number(value);
    if (next === "auto" || props.accounts.some((a) => a.number === next)) props.onSelect(next);
  };
  return (
    <box position="absolute" left="22%" right="22%" top="10%" bottom={5}
      flexDirection="column" backgroundColor={colors.panelRaised} border borderColor={colors.borderStrong}
      padding={1} zIndex={160}>
      <box flexDirection="row">
        <text fg={colors.textBright} attributes={1}>Claude usage account (cswap)</text>
        <box flexGrow={1} />
        <text fg={colors.cyan} onMouseDown={(event) => { event.preventDefault(); props.onCancel(); }}>← Settings</text>
      </box>
      <text fg={colors.subtle}>Choose account for new Pi sessions and usage display.</text>
      <select ref={(value) => { select = value; }} focused height={Math.min(12, Math.max(5, choices().length * 2))}
        options={choices()} selectedIndex={0}
        backgroundColor={colors.panelRaised} focusedBackgroundColor={colors.panelRaised}
        textColor={colors.text} focusedTextColor={colors.textBright}
        selectedBackgroundColor={colors.selection} selectedTextColor={colors.textBright}
        descriptionColor={colors.muted} selectedDescriptionColor={colors.text}
        onSelect={(_i, item) => choose(item?.value)}
        onMouseDown={(event) => {
          if (!select) return;
          const item = choices()[Math.floor((event.y - select.screenY) / 2)];
          if (!item) return;
          event.preventDefault();
          choose(item.value);
        }}
      />
      <text fg={colors.subtle}>Selected account: {props.accounts.find((a) => a.number === props.effectiveSlot)?.label ?? "Unknown"}. Restart PiTTY to apply to the current session.</text>
      <text fg={colors.subtle}>Enter select · Esc back</text>
    </box>
  );
}
