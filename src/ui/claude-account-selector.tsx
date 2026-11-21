import type { SelectRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { ClaudeAccountChoice, CswapAccount } from "../integrations/claude-swap.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";

export function ClaudeAccountSelector(props: {
  accounts: CswapAccount[];
  selection: ClaudeAccountChoice;
  effectiveSlot?: number | undefined;
  currentAccountLabel?: string | undefined;
  onSelect: (choice: ClaudeAccountChoice) => void;
  onCancel: () => void;
}) {
  let select: SelectRenderable | undefined;
  const choices = createMemo(() => [
    { name: "Automatic (launcher profile)", description: "Use the launch environment for new tabs", value: "auto" },
    ...props.accounts.map((account) => ({
      name: `${account.label} (slot ${account.number})`,
      description: account.usage?.limits.map((limit) => `${limit.label} ${limit.percent === null ? "?" : Math.round(limit.percent)}%`).join(" · ") || account.usageStatus,
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
    <DialogFrame title="Claude account for new tabs" summary="cswap" width="normal" closeLabel="esc ‹ settings" zIndex={160} onClose={props.onCancel}>
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
      <text fg={colors.subtle}>Current tab: {props.currentAccountLabel ?? props.accounts.find((a) => a.number === props.effectiveSlot)?.label ?? "Unknown"}. This selection applies to new tabs.</text>
    </DialogFrame>
  );
}
