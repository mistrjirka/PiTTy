/** Session switching, fork, and model picker dialogs. */
import { type Accessor, type Setter, Show } from "solid-js";
import type { SessionChoice, SessionDiscoveryState } from "../sessions.ts";
import type { ForkPickerOption } from "../tabs/entry-index.ts";
import type { ModelPerformanceHistory } from "../tabs/model-performance-history.ts";
import type { RequestTiming } from "../tabs/request-timing.ts";
import type { RpcSessionState } from "../types.ts";
import { ForkPicker } from "./fork-picker.tsx";
import { type ModelChoice, ModelSelectorDialog } from "./model-selector.tsx";
import { SessionSelector } from "./session-selector.tsx";

export interface SessionOverlaysProps {
	sessionSelectorOpen: Accessor<boolean>;
	sessionDiscovery: Accessor<SessionDiscoveryState>;
	sessionSwitching: Accessor<boolean>;
	streaming: Accessor<boolean>;
	pendingSessionReason: Accessor<"streaming" | "queued" | undefined>;
	queuedCount: () => number;
	pendingSession: Accessor<SessionChoice | undefined>;
	switchToSession: (choice: SessionChoice) => Promise<void>;
	setPendingSession: Setter<SessionChoice | undefined>;
	setPendingSessionReason: Setter<"streaming" | "queued" | undefined>;
	closeSessionSelector: () => void;
	discoverCurrentSessions: () => Promise<void>;
	forkPickerOpen: Accessor<boolean>;
	forkPickerOptionsSignal: Accessor<ForkPickerOption[]>;
	setForkPickerOpen: Setter<boolean>;
	forkAt: (entryId: string) => Promise<void>;
	modelSelectorOpen: Accessor<boolean>;
	modelOptions: Accessor<ModelChoice[]>;
	sessionState: () => RpcSessionState | undefined;
	readModelPerformanceHistory: () => ModelPerformanceHistory;
	requestTimingHistory: () => readonly RequestTiming[];
	modelListNotice: Accessor<string | undefined>;
	selectModel: (model: ModelChoice) => Promise<void>;
	closeModelSelector: () => void;
}

export function SessionOverlays(props: SessionOverlaysProps) {
	return (
		<>
			<Show when={props.sessionSelectorOpen()}>
				<SessionSelector
					state={props.sessionDiscovery()}
					switching={props.sessionSwitching()}
					streaming={props.streaming()}
					confirmation={props.pendingSessionReason()}
					queuedCount={props.queuedCount()}
					pending={props.pendingSession()}
					onSelect={(choice) => void props.switchToSession(choice)}
					onConfirm={() => {
						const choice = props.pendingSession();
						if (choice) void props.switchToSession(choice);
					}}
					onDecline={() => {
						props.setPendingSession(undefined);
						props.setPendingSessionReason(undefined);
					}}
					onCancel={props.closeSessionSelector}
					onRetry={() => void props.discoverCurrentSessions()}
				/>
			</Show>
			<Show when={props.forkPickerOpen()}>
				<ForkPicker
					options={props.forkPickerOptionsSignal()}
					onCancel={() => props.setForkPickerOpen(false)}
					onSelect={(entryId) => {
						props.setForkPickerOpen(false);
						void props.forkAt(entryId);
					}}
				/>
			</Show>
			<Show when={props.modelSelectorOpen()}>
				<ModelSelectorDialog
					models={props.modelOptions()}
					currentProvider={props.sessionState()?.model?.provider}
					currentModelId={props.sessionState()?.model?.id}
					performanceHistory={props.readModelPerformanceHistory}
					timingHistory={props.requestTimingHistory}
					notice={props.modelListNotice()}
					onSelect={(model) => void props.selectModel(model)}
					onCancel={props.closeModelSelector}
				/>
			</Show>
		</>
	);
}
