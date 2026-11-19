import { For, Show } from "solid-js";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { PendingInputItem, QueuedInputActions } from "../tabs/queued-input-actions.ts";
export type { LocalQueuedMessage } from "../state/input-continuity.ts";
import { colors } from "./theme.ts";

function clip(value: string, width = 72): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= width ? normalized : `${normalized.slice(0, width - 1)}…`;
}

export type PendingInputPanelProps = {
	queuedFollowUps: readonly LocalQueuedMessage[];
	steering: readonly string[];
	followUps: readonly string[];
	onEditQueuedFollowUp: (messageId: string) => void;
	pendingInput?: QueuedInputActions | undefined;
	/** Maximum rows available above the main prompt. */
	maxRows?: number;
};

function PendingAction(props: { id: string; label: string; disabled: boolean; onClick: () => void }) {
	return (
		<text id={props.id} height={1} flexShrink={0} fg={props.disabled ? colors.subtle : colors.cyan}
			wrapMode="none" onMouseDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!props.disabled) props.onClick();
			}}>
			{" [" + props.label + "]"}
		</text>
	);
}

export function PendingInputPanel(props: PendingInputPanelProps) {
	const entries = (): PendingInputItem[] => props.pendingInput?.messages() ??
		props.queuedFollowUps.map((item) => ({ id: item.id, source: "local", mode: "followUp", text: item.text }));
	const canCombine = (index: number): boolean => {
		const items = entries(), first = items[index], next = items[index + 1];
		return Boolean(first && next && first.source === next.source && first.mode === next.mode);
	};
	const disabled = () => Boolean(props.pendingInput?.busy() || props.pendingInput?.editing());
	return (
		<box flexDirection="column" height={Math.min(9, Math.max(3, props.maxRows ?? 9))}
			maxHeight={9} minHeight={3} flexShrink={1} paddingLeft={2} paddingRight={2}
			paddingTop={1} paddingBottom={1} backgroundColor={colors.panelSoft}
			border={["top"]} borderColor={colors.borderStrong}>
			<text fg={colors.yellow} attributes={1}>Pending input{props.pendingInput?.busy() ? " · saving…" : ""}</text>
			<Show when={props.pendingInput?.editing()}>
				<box flexDirection="row" height={1} minHeight={1} flexShrink={0}>
					<box flexGrow={1} minWidth={0} overflow="hidden">
						<text fg={colors.yellow} wrapMode="none">
							Editing · Enter saves · Original stays queued until saved
						</text>
					</box>
					<PendingAction id="pending-cancel-edit" label="Cancel edit"
						disabled={Boolean(props.pendingInput?.busy())} onClick={() => props.pendingInput?.cancelEdit()} />
				</box>
			</Show>
			<scrollbox flexGrow={1} height={Math.min(4, Math.max(1, (props.maxRows ?? 9) - 4))}
				minHeight={1} maxHeight={4} flexShrink={1} focusable={false} scrollY scrollX={false}
				viewportCulling={true} verticalScrollbarOptions={{
					showArrows: false, trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.background },
				}} onMouseScroll={(event) => { event.preventDefault(); event.stopPropagation(); }}>
				<For each={entries()}>
					{(item, index) => (
						<box height={1} minHeight={1} flexShrink={0} flexDirection="row">
							<box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
								<text height={1} fg={colors.text} selectable wrapMode="none"
									onMouseDown={(event) => {
										event.preventDefault(); event.stopPropagation();
										if (props.pendingInput) props.pendingInput.edit(item);
										else props.onEditQueuedFollowUp(item.id);
									}}>
									{" "}{index() + 1}. {props.pendingInput ? item.mode === "steer" ? "next step" : "after turn" : "editable later"}: {clip(item.text)}
								</text>
							</box>
							<Show when={props.pendingInput} fallback={<text height={1} fg={colors.cyan} wrapMode="none">click to edit</text>}>
								<PendingAction id={`pending-edit-${item.id}`} label="Edit" disabled={disabled()}
									onClick={() => props.pendingInput?.edit(item)} />
								<PendingAction id={`pending-cancel-${item.id}`} label="Cancel" disabled={disabled()}
									onClick={() => { void props.pendingInput?.cancel(item); }} />
								<Show when={canCombine(index())}>
									<PendingAction id={`pending-combine-${item.id}`} label="Combine next" disabled={disabled()}
										onClick={() => { void props.pendingInput?.combineWithNext(item); }} />
								</Show>
							</Show>
						</box>
					)}
				</For>
				<Show when={!props.pendingInput?.queueSupported()}>
					<Show when={props.steering.length || props.followUps.length}>
						<text height={1} minHeight={1} flexShrink={0} fg={colors.subtle} wrapMode="none">
							Queued in Pi, not yet delivered to the model
						</text>
					</Show>
					<For each={props.steering}>{(text) => (
						<text height={1} minHeight={1} flexShrink={0} fg={colors.muted} selectable wrapMode="none"> steering: {clip(text)}</text>
					)}</For>
					<For each={props.followUps}>{(text) => (
						<text height={1} minHeight={1} flexShrink={0} fg={colors.muted} selectable wrapMode="none"> follow-up: {clip(text)}</text>
					)}</For>
				</Show>
			</scrollbox>
			<Show when={entries().length || props.pendingInput?.editing()}>
				<text fg={colors.subtle} wrapMode="none">
					{props.pendingInput?.editing() ? "Escape cancels editing. Your previous draft is preserved."
						: props.pendingInput ? "Alt+Up edits the last pending message. Combine joins it with the next."
						: "Alt+Up edits the last editable local follow-up."}
				</text>
			</Show>
		</box>
	);
}
