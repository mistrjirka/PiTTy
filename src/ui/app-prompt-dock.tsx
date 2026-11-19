/** Prompt-adjacent input overlays. Never let suggestions hide the editor. */
import { Show, type Accessor, type JSX } from "solid-js";
import type { LocalQueuedMessage } from "../state/input-continuity.ts";
import {
	CommandSuggestions,
	type CommandChoice,
} from "./command-suggestions.tsx";
import { PendingInputPanel } from "./pending-input-panel.tsx";

export interface AppPromptDockProps {
	viewportRows: Accessor<number>;
	enabled: Accessor<boolean>;
	queuedFollowUps: () => LocalQueuedMessage[];
	steeringQueue: Accessor<string[]>;
	followUpQueue: Accessor<string[]>;
	editQueuedFollowUp: (id: string) => void;
	commandSuggestions: Accessor<CommandChoice[]>;
	commandSuggestionIndex: Accessor<number>;
	insertSuggestedCommand: (command: CommandChoice) => void;
	children: JSX.Element;
}

export function AppPromptDock(props: AppPromptDockProps) {
	// Reserve rows for tab strip, transcript, jump slot, editor, and footer.
	// The popup is the first panel to shrink when the terminal is small.
	const availableRows = () => Math.max(2, props.viewportRows() - 8);
	const suggestionsOpen = () =>
		props.enabled() && props.commandSuggestions().length > 0;
	const pending = () =>
		props.queuedFollowUps().length > 0 ||
		props.steeringQueue().length > 0 ||
		props.followUpQueue().length > 0;

	return (
		<>
			<Show when={props.enabled() && pending() && !suggestionsOpen()}>
				<PendingInputPanel
					queuedFollowUps={props.queuedFollowUps()}
					steering={props.steeringQueue()}
					followUps={props.followUpQueue()}
					onEditQueuedFollowUp={props.editQueuedFollowUp}
					maxRows={availableRows()}
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
					maxHeight={availableRows()}
					onSelect={props.insertSuggestedCommand}
				/>
			</Show>
			{props.children}
		</>
	);
}
