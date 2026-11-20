/** Compaction and subagent model configuration dialogs. No session ownership. */
import { type Accessor, type Setter, Show } from "solid-js";
import {
	type CompactionModelState,
	type ExtensionThinkingLevel,
	parseModelRef,
	type SubagentModelEntry,
} from "../config/extension-models.ts";
import type { SettingsErrorMap } from "../tabs/extension-model-actions.ts";
import type { ModelPerformanceHistory } from "../tabs/model-performance-history.ts";
import type { RequestTiming } from "../tabs/request-timing.ts";
import type { SettingsRoute } from "./app-navigation.ts";
import {
	type ExtensionSettingRow,
	ExtensionSettingsList,
} from "./extension-settings.tsx";
import { type ModelChoice, ModelSelectorDialog } from "./model-selector.tsx";
import type { SettingsAction } from "./settings-descriptors.ts";
import { ThinkingSelector } from "./thinking-selector.tsx";

export interface ExtensionSettingsOverlaysProps {
	settingsRoute: Accessor<SettingsRoute>;
	setSettingsRoute: Setter<SettingsRoute>;
	settingsBusy: Accessor<SettingsAction | undefined>;
	settingsErrors: Accessor<SettingsErrorMap>;
	setSettingsSelectedId: Setter<string>;
	detailSettingSelectedId: Accessor<string>;
	setDetailSettingSelectedId: Setter<string>;
	compactionSettingsRows: () => ExtensionSettingRow[];
	subagentListRows: () => ExtensionSettingRow[];
	selectedSubagentModelId: Accessor<string>;
	setSelectedSubagentModelId: Setter<string>;
	subagentSettingsRows: () => ExtensionSettingRow[];
	modelOptions: Accessor<ModelChoice[]>;
	compactionModelState: Accessor<CompactionModelState | undefined>;
	selectedSubagentModelEntry: () => SubagentModelEntry | undefined;
	requestTimingHistory: () => readonly RequestTiming[];
	readModelPerformanceHistory: () => ModelPerformanceHistory;
	compactionModelContext: () => string | undefined;
	subagentModelContext: () => string | undefined;
	compactionThinkingLevels: () => ExtensionThinkingLevel[];
	subagentThinkingLevels: () => ExtensionThinkingLevel[];
	compactionThinkingContext: () => string;
	subagentThinkingContext: () => string;
	openCompactionSetting: (id: string) => void;
	openSubagentSettings: (entry: SubagentModelEntry) => void;
	openSubagentSetting: (id: string) => void;
	subagentModelEntries: Accessor<SubagentModelEntry[]>;
	applyCompactionModel: (model: ModelChoice) => Promise<void>;
	applySubagentModel: (model: ModelChoice) => Promise<void>;
	applyCompactionThinking: (level: string) => Promise<void>;
	applySubagentThinking: (level: string) => Promise<void>;
}

export function ExtensionSettingsOverlays(
	props: ExtensionSettingsOverlaysProps,
) {
	return (
		<>
			<Show when={props.settingsRoute() === "compaction"}>
				<ExtensionSettingsList
					title="Compaction settings"
					backLabel="esc ‹ settings"
					rows={props.compactionSettingsRows()}
					selectedId={props.detailSettingSelectedId()}
					busy={props.settingsBusy() === "compaction"}
					error={props.settingsErrors().compaction}
					onSelected={props.setDetailSettingSelectedId}
					onOpen={props.openCompactionSetting}
					onCancel={() => {
						props.setSettingsRoute("root");
						props.setSettingsSelectedId("compaction");
					}}
				/>
			</Show>
			<Show when={props.settingsRoute() === "compaction-model"}>
				<ModelSelectorDialog
					models={props.modelOptions()}
					currentProvider={
						parseModelRef(props.compactionModelState()?.model)?.provider
					}
					currentModelId={
						parseModelRef(props.compactionModelState()?.model)?.id
					}
					performanceHistory={props.readModelPerformanceHistory}
					timingHistory={props.requestTimingHistory}
					context={props.compactionModelContext()}
					onSelect={(model) => void props.applyCompactionModel(model)}
					backLabel="esc ‹ compaction"
					onCancel={() => props.setSettingsRoute("compaction")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "compaction-thinking"}>
				<ThinkingSelector
					current={props.compactionModelState()?.thinkingLevel}
					levels={props.compactionThinkingLevels()}
					context={props.compactionThinkingContext()}
					busy={props.settingsBusy() === "compaction"}
					{...(props.settingsErrors().compaction
						? { error: props.settingsErrors().compaction }
						: {})}
					onSelect={(level) => void props.applyCompactionThinking(level)}
					backLabel="esc ‹ compaction"
					onCancel={() => props.setSettingsRoute("compaction")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "subagents"}>
				<ExtensionSettingsList
					title="Subagent models"
					backLabel="esc ‹ settings"
					rows={props.subagentListRows()}
					selectedId={props.selectedSubagentModelId()}
					busy={props.settingsBusy() === "subagents"}
					error={props.settingsErrors().subagents}
					onSelected={props.setSelectedSubagentModelId}
					onOpen={(id) => {
						const entry = props
							.subagentModelEntries()
							.find((candidate) => candidate.id === id);
						if (entry) props.openSubagentSettings(entry);
					}}
					onCancel={() => {
						props.setSettingsRoute("root");
						props.setSettingsSelectedId("subagents");
					}}
				/>
			</Show>
			<Show when={props.settingsRoute() === "subagent"}>
				<ExtensionSettingsList
					title={`Subagent: ${props.selectedSubagentModelId() === "defaults" ? "Defaults" : props.selectedSubagentModelId()}`}
					backLabel="esc ‹ agents"
					rows={props.subagentSettingsRows()}
					selectedId={props.detailSettingSelectedId()}
					busy={props.settingsBusy() === "subagents"}
					error={props.settingsErrors().subagents}
					onSelected={props.setDetailSettingSelectedId}
					onOpen={props.openSubagentSetting}
					onCancel={() => props.setSettingsRoute("subagents")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "subagent-model"}>
				<ModelSelectorDialog
					models={props.modelOptions()}
					currentProvider={
						parseModelRef(props.selectedSubagentModelEntry()?.model)?.provider
					}
					currentModelId={
						parseModelRef(props.selectedSubagentModelEntry()?.model)?.id
					}
					performanceHistory={props.readModelPerformanceHistory}
					timingHistory={props.requestTimingHistory}
					context={props.subagentModelContext()}
					onSelect={(model) => void props.applySubagentModel(model)}
					backLabel="esc ‹ agent"
					onCancel={() => props.setSettingsRoute("subagent")}
				/>
			</Show>
			<Show when={props.settingsRoute() === "subagent-thinking"}>
				<ThinkingSelector
					current={props.selectedSubagentModelEntry()?.thinking}
					levels={props.subagentThinkingLevels()}
					context={props.subagentThinkingContext()}
					busy={props.settingsBusy() === "subagents"}
					{...(props.settingsErrors().subagents
						? { error: props.settingsErrors().subagents }
						: {})}
					onSelect={(level) => void props.applySubagentThinking(level)}
					backLabel="esc ‹ agent"
					onCancel={() => props.setSettingsRoute("subagent")}
				/>
			</Show>
		</>
	);
}
