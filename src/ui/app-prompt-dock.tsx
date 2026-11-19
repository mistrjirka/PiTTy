/** Prompt-adjacent input overlays. Never let suggestions hide the editor. */
import type { QueuedInputActions } from "../tabs/queued-input-actions.ts";
import { createMemo, createSignal, Show, type Accessor, type JSX } from "solid-js";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import type { ExtensionTextWidget } from "../state/extension-widgets.ts";
import {
	CommandSuggestions,
	type CommandChoice,
} from "./command-suggestions.tsx";
import { ExtensionWidgetArea } from "./extension-widget-area.tsx";
import { PendingInputPanel } from "./pending-input-panel.tsx";

export interface AppPromptDockProps {
	viewportRows: Accessor<number>;
	enabled: Accessor<boolean>;
	extensionWidgets?: (() => readonly ExtensionTextWidget[]) | undefined;
	extensionWidgetScope?: Accessor<string> | undefined;
	queuedFollowUps: () => LocalQueuedMessage[];
	steeringQueue: Accessor<string[]>;
	followUpQueue: Accessor<string[]>;
	editQueuedFollowUp: (id: string) => void;
	pendingInput?: QueuedInputActions | undefined;
	commandSuggestions: Accessor<CommandChoice[]>;
	commandSuggestionIndex: Accessor<number>;
	insertSuggestedCommand: (command: CommandChoice) => void;
	children: JSX.Element;
}

export function AppPromptDock(props: AppPromptDockProps) {
	// Reserve rows for tab strip, transcript, jump slot, editor, and footer.
	// Widgets and suggestions shrink first when the terminal is small.
	const availableRows = () => Math.max(2, props.viewportRows() - 8);
	const above = createMemo(() => (props.extensionWidgets?.() ?? [])
		.filter((widget) => widget.placement === "aboveEditor" && widget.lines.length > 0));
	const below = createMemo(() => (props.extensionWidgets?.() ?? [])
		.filter((widget) => widget.placement === "belowEditor" && widget.lines.length > 0));
	const [aboveRows, setAboveRows] = createSignal(1);
	const [belowRows, setBelowRows] = createSignal(1);
	const widgetRows = () => {
		const budget = Math.min(10, Math.floor(availableRows() / 2));
		const aboveDemand = above().length ? Math.max(1, aboveRows()) : 0;
		const belowDemand = below().length ? Math.max(1, belowRows()) : 0;
		const belowReserve = Math.min(belowDemand, Math.floor(budget / 2));
		const aboveLimit = Math.min(aboveDemand, budget - belowReserve);
		return { above: aboveLimit, below: Math.min(belowDemand, budget - aboveLimit) };
	};
	const popupRows = () => availableRows() -
		(props.enabled() ? widgetRows().above + widgetRows().below : 0);
	const suggestionsOpen = () =>
		props.enabled() && !props.pendingInput?.editing() && props.commandSuggestions().length > 0;
	const pending = () =>
		props.pendingInput?.editing() !== undefined ||
		(props.pendingInput?.messages().length ?? 0) > 0 ||
		props.queuedFollowUps().length > 0 ||
		props.steeringQueue().length > 0 ||
		props.followUpQueue().length > 0;

	return (
		<>
			<Show when={props.enabled() && (props.extensionWidgetScope?.() ?? "widgets")} keyed>
				{(_scope) => <ExtensionWidgetArea widgets={above()} maxRows={widgetRows().above}
					id="extension-widgets-above" onContentRows={setAboveRows} />}
			</Show>
			<Show when={props.enabled() && pending() && !suggestionsOpen()}>
				<PendingInputPanel
					queuedFollowUps={props.queuedFollowUps()}
					steering={props.steeringQueue()}
					followUps={props.followUpQueue()}
					onEditQueuedFollowUp={props.editQueuedFollowUp}
					pendingInput={props.pendingInput}
					maxRows={popupRows()}
				/>
			</Show>
			<Show when={suggestionsOpen()}>
				<CommandSuggestions
					commands={props.commandSuggestions}
					selectedIndex={() =>
						Math.min(
							props.commandSuggestionIndex(),
							Math.max(0, props.commandSuggestions().length - 1),
						)
					}
					maxHeight={popupRows()}
					onSelect={props.insertSuggestedCommand}
				/>
			</Show>
			{props.children}
			<Show when={props.enabled() && (props.extensionWidgetScope?.() ?? "widgets")} keyed>
				{(_scope) => <ExtensionWidgetArea widgets={below()} maxRows={widgetRows().below}
					id="extension-widgets-below" onContentRows={setBelowRows} />}
			</Show>
		</>
	);
}
