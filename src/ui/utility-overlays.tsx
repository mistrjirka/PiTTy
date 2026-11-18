/** Background job, notification, memory, subagent and extension dialogs. */
import { type Accessor, type Setter, Show } from "solid-js";
import type {
	MemoryEntry,
	MemorySnapshot,
} from "../integrations/memory-store.ts";
import type {
	BackgroundOutputPage,
	BackgroundTask,
	BackgroundTaskSelection,
} from "../state/background-tasks.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { NotificationRecord, RpcExtensionUIRequest } from "../types.ts";
import { BackgroundTaskDialog } from "./background-task-dialog.tsx";
import type { CommandChoice } from "./command-suggestions.tsx";
import { ExtensionDialog } from "./dialog.tsx";
import { MemoryBrowserDialog } from "./memory-browser.tsx";
import { NotificationDialog } from "./notification-dialog.tsx";
import { PromptMapDialog, type PromptMapEntry } from "./prompt-map.tsx";
import { SkillSelector } from "./skill-selector.tsx";
import { SubagentSelectorDialog } from "./subagent-selector.tsx";
import { TodoDialog } from "./todo-dialog.tsx";
import type { TodoViewItem } from "./todos.tsx";

export type ExtensionDialogResponse = {
	cancelled?: true;
	confirmed?: boolean;
	value?: string;
};

export interface UtilityOverlaysProps {
	backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	selectedBackgroundTask: Accessor<BackgroundTask | undefined>;
	clockNow: Accessor<number>;
	backgroundOutput: Accessor<BackgroundOutputPage | undefined>;
	backgroundOutputBusy: Accessor<boolean>;
	backgroundOutputError: Accessor<string | undefined>;
	showBackgroundOutputPage: (page: number) => Promise<void>;
	analyzeBackgroundTask: () => void;
	closeBackgroundTask: () => void;
	notificationDetailId: Accessor<string | undefined>;
	notificationHistory: Accessor<NotificationRecord[]>;
	closeNotification: () => void;
	todoDetailId: Accessor<string | undefined>;
	todos: () => TodoViewItem[];
	closeTodo: () => void;
	promptMapOpen: Accessor<boolean>;
	promptMapEntries: () => PromptMapEntry[];
	jumpToPrompt: (entry: PromptMapEntry) => void;
	closePromptMap: () => void;
	memoryBrowserOpen: Accessor<boolean>;
	memorySnapshot: Accessor<MemorySnapshot | undefined>;
	removeMemory: (entry: MemoryEntry) => void;
	closeMemoryBrowser: () => void;
	subagentSelectorOpen: Accessor<boolean>;
	availableSubagentTargets: () => SubagentTarget[];
	selectedTargetKey: () => string | undefined;
	selectSubagentTarget: (target: SubagentTarget) => void;
	setSubagentSelectorOpen: Setter<boolean>;
	skillSelectorOpen: Accessor<boolean>;
	commandChoices: () => CommandChoice[];
	setSkillSelectorOpen: Setter<boolean>;
	syncMainDraft: (text: string) => void;
	focusMainPrompt: () => void;
	submit: () => Promise<void>;
	dialog: Accessor<RpcExtensionUIRequest | undefined>;
	completeDialog: (response: ExtensionDialogResponse) => Promise<void>;
}

export function UtilityOverlays(props: UtilityOverlaysProps) {
	return (
		<>
			<Show
				when={props.backgroundSelection() && props.selectedBackgroundTask()}
			>
				<BackgroundTaskDialog
					task={props.selectedBackgroundTask}
					now={props.clockNow()}
					output={props.backgroundOutput}
					busy={props.backgroundOutputBusy()}
					{...(props.backgroundOutputError()
						? { error: props.backgroundOutputError() }
						: {})}
					onPage={(page) => void props.showBackgroundOutputPage(page)}
					onAnalyze={props.analyzeBackgroundTask}
					onClose={props.closeBackgroundTask}
				/>
			</Show>
			<Show when={props.notificationDetailId()}>
				<NotificationDialog
					record={() =>
						props
							.notificationHistory()
							.find((record) => record.id === props.notificationDetailId())
					}
					onClose={props.closeNotification}
				/>
			</Show>
			<Show when={props.todoDetailId()}>
				<TodoDialog
					todo={() =>
						props.todos().find((todo) => todo.id === props.todoDetailId())
					}
					onClose={props.closeTodo}
				/>
			</Show>
			<Show when={props.promptMapOpen()}>
				<PromptMapDialog
					entries={props.promptMapEntries()}
					onSelect={props.jumpToPrompt}
					onCancel={props.closePromptMap}
				/>
			</Show>
			<Show when={props.memoryBrowserOpen() && props.memorySnapshot()}>
				<MemoryBrowserDialog
					snapshot={props.memorySnapshot()!}
					onRemove={props.removeMemory}
					onCancel={props.closeMemoryBrowser}
				/>
			</Show>
			<Show when={props.subagentSelectorOpen()}>
				<SubagentSelectorDialog
					targets={props.availableSubagentTargets()}
					selectedKey={props.selectedTargetKey()}
					onSelect={props.selectSubagentTarget}
					onCancel={() => props.setSubagentSelectorOpen(false)}
				/>
			</Show>
			<Show when={props.skillSelectorOpen()}>
				<SkillSelector
					commands={props.commandChoices}
					onSelect={(invocation) => {
						// Behave exactly as if the user typed the invocation:
						// close first, then run it through the normal props.submit path.
						props.setSkillSelectorOpen(false);
						props.syncMainDraft(invocation);
						props.focusMainPrompt();
						void props.submit();
					}}
					onCancel={() => {
						props.setSkillSelectorOpen(false);
						props.focusMainPrompt();
					}}
				/>
			</Show>
			<Show when={props.dialog()}>
				{(request) => (
					<ExtensionDialog
						request={request()}
						onValue={(value) => void props.completeDialog({ value })}
						onConfirm={(confirmed) => void props.completeDialog({ confirmed })}
						onCancel={() => void props.completeDialog({ cancelled: true })}
					/>
				)}
			</Show>
		</>
	);
}
