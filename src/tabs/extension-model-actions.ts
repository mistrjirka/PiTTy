/** Compaction and subagent profile model settings. No RPC or UI ownership. */
import type { Accessor, Setter } from "solid-js";
import {
	type CompactionModelState,
	EXTENSION_THINKING_LEVELS,
	type ExtensionThinkingLevel,
	loadCompactionModelState,
	loadSubagentModelEntries,
	parseModelRef,
	type SubagentModelEntry,
	writeCompactionModel,
	writeCompactionThinking,
	writeSubagentModel,
	writeSubagentThinking,
} from "../config/extension-models.ts";
import type { Toast } from "../types.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { ExtensionSettingRow } from "../ui/extension-settings.tsx";
import type { ModelChoice } from "../ui/model-selector.tsx";
import type { SettingsAction } from "../ui/settings-descriptors.ts";
import { compatibleThinkingLevels } from "../ui/thinking-selector.tsx";
import type { ConversationTabRuntime } from "./runtime.ts";

export type SettingsErrorMap = Partial<Record<SettingsAction, string>>;

export interface ExtensionModelPorts {
	readonly cwd: string;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		duration?: number,
	) => void;
	readonly modelSelectorLoading: Accessor<boolean>;
	readonly setModelSelectorLoading: Setter<boolean>;
	readonly settingsBusy: Accessor<SettingsAction | undefined>;
	readonly setSettingsBusy: Setter<SettingsAction | undefined>;
	readonly setSettingsErrors: Setter<SettingsErrorMap>;
	readonly setModelOptions: Setter<ModelChoice[]>;
	readonly modelOptions: Accessor<ModelChoice[]>;
	readonly cachedModels: () => readonly ModelChoice[] | undefined;
	readonly fetchAvailableModels: () => Promise<ModelChoice[]>;
	readonly compactionModelState: Accessor<CompactionModelState | undefined>;
	readonly setCompactionModelState: Setter<CompactionModelState | undefined>;
	readonly subagentModelEntries: Accessor<SubagentModelEntry[]>;
	readonly setSubagentModelEntries: Setter<SubagentModelEntry[]>;
	readonly selectedSubagentModelId: Accessor<string>;
	readonly setSelectedSubagentModelId: Setter<string>;
	readonly setSettingsSelectedId: Setter<string>;
	readonly setDetailSettingSelectedId: Setter<string>;
	readonly setSettingsRoute: Setter<SettingsRoute>;
}

export interface ExtensionModelActions {
	readonly refreshCompactionModel: () => Promise<boolean>;
	readonly refreshSubagentModels: () => Promise<boolean>;
	readonly openCompactionSettings: () => Promise<void>;
	readonly openSubagentModels: () => Promise<void>;
	readonly openSubagentSettings: (entry: SubagentModelEntry) => void;
	readonly applyCompactionModel: (model: ModelChoice) => Promise<void>;
	readonly applySubagentModel: (model: ModelChoice) => Promise<void>;
	readonly applyCompactionThinking: (level: string) => Promise<void>;
	readonly applySubagentThinking: (level: string) => Promise<void>;
	readonly selectedSubagentModelEntry: () => SubagentModelEntry | undefined;
	readonly subagentListRows: () => ExtensionSettingRow[];
	readonly subagentSettingsRows: () => ExtensionSettingRow[];
	readonly compactionSettingsRows: () => ExtensionSettingRow[];
	readonly openCompactionSetting: (id: string) => void;
	readonly openSubagentSetting: (id: string) => void;
	readonly compactionThinkingLevels: () => ExtensionThinkingLevel[];
	readonly subagentThinkingLevels: () => ExtensionThinkingLevel[];
	readonly compactionThinkingContext: () => string;
	readonly subagentThinkingContext: () => string;
	readonly compactionModelContext: () => string | undefined;
	readonly subagentModelContext: () => string | undefined;
}

export function createExtensionModelActions(
	ports: ExtensionModelPorts,
): ExtensionModelActions {
	const refreshCompactionModel = async (): Promise<boolean> => {
		try {
			ports.setCompactionModelState(
				await loadCompactionModelState({ cwd: ports.cwd }),
			);
			ports.setSettingsErrors((errors) => {
				const next = { ...errors };
				delete next.compaction;
				return next;
			});
			return true;
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				compaction: error instanceof Error ? error.message : String(error),
			}));
			return false;
		}
	};
	const refreshSubagentModels = async (): Promise<boolean> => {
		try {
			ports.setSubagentModelEntries(
				await loadSubagentModelEntries({ cwd: ports.cwd }),
			);
			ports.setSettingsErrors((errors) => {
				const next = { ...errors };
				delete next.subagents;
				return next;
			});
			return true;
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				subagents: error instanceof Error ? error.message : String(error),
			}));
			return false;
		}
	};
	const ensureExtensionModels = async (
		key: "compaction" | "subagents",
	): Promise<boolean> => {
		if (!ports.activeRuntime().startupResolved) {
			ports.toast("This tab is still starting…", "info");
			return false;
		}
		if (ports.modelSelectorLoading()) return false;
		ports.setSettingsBusy(key);
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next[key];
			return next;
		});
		ports.setModelSelectorLoading(true);
		try {
			ports.setModelOptions(await ports.fetchAvailableModels());
			return true;
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				[key]: error instanceof Error ? error.message : String(error),
			}));
			return false;
		} finally {
			ports.setModelSelectorLoading(false);
			ports.setSettingsBusy(undefined);
		}
	};
	const openCompactionSettings = async () => {
		ports.setSettingsSelectedId("compaction");
		if (await refreshCompactionModel()) {
			ports.setDetailSettingSelectedId("model");
			ports.setSettingsRoute("compaction");
		}
	};
	const openCompactionModelPicker = async () => {
		if (await ensureExtensionModels("compaction"))
			ports.setSettingsRoute("compaction-model");
	};
	const openSubagentModels = async () => {
		ports.setSettingsSelectedId("subagents");
		if (await refreshSubagentModels()) ports.setSettingsRoute("subagents");
	};
	const openSubagentSettings = (entry: SubagentModelEntry) => {
		ports.setSelectedSubagentModelId(entry.id);
		ports.setDetailSettingSelectedId("model");
		ports.setSettingsRoute("subagent");
	};
	const openSubagentModelPicker = async () => {
		if (await ensureExtensionModels("subagents"))
			ports.setSettingsRoute("subagent-model");
	};
	const applyCompactionModel = async (model: ModelChoice) => {
		if (ports.settingsBusy()) return;
		ports.setSettingsRoute("compaction");
		ports.setDetailSettingSelectedId("model");
		ports.setSettingsBusy("compaction");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.compaction;
			return next;
		});
		try {
			await writeCompactionModel(`${model.provider}/${model.id}`, {
				cwd: ports.cwd,
			});
			await refreshCompactionModel();
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				compaction: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const applySubagentModel = async (model: ModelChoice) => {
		if (ports.settingsBusy()) return;
		const id = ports.selectedSubagentModelId();
		const entry = ports
			.subagentModelEntries()
			.find((candidate) => candidate.id === id);
		if (!entry) return;
		ports.setSettingsRoute("subagent");
		ports.setDetailSettingSelectedId("model");
		ports.setSettingsBusy("subagents");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.subagents;
			return next;
		});
		try {
			await writeSubagentModel(
				id,
				`${model.provider}/${model.id}`,
				entry.scope,
				{ cwd: ports.cwd },
			);
			await refreshSubagentModels();
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				subagents: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const applyCompactionThinking = async (level: string) => {
		if (ports.settingsBusy()) return;
		const thinkingLevel = EXTENSION_THINKING_LEVELS.find(
			(candidate) => candidate === level,
		);
		if (!thinkingLevel) return;
		ports.setSettingsRoute("compaction");
		ports.setDetailSettingSelectedId("thinking");
		ports.setSettingsBusy("compaction");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.compaction;
			return next;
		});
		try {
			await writeCompactionThinking(thinkingLevel, { cwd: ports.cwd });
			await refreshCompactionModel();
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				compaction: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const applySubagentThinking = async (level: string) => {
		if (ports.settingsBusy()) return;
		const thinkingLevel: ExtensionThinkingLevel | undefined =
			EXTENSION_THINKING_LEVELS.find((candidate) => candidate === level);
		const id = ports.selectedSubagentModelId();
		const entry = ports
			.subagentModelEntries()
			.find((candidate) => candidate.id === id);
		if (!thinkingLevel || !entry) return;
		ports.setSettingsRoute("subagent");
		ports.setDetailSettingSelectedId("thinking");
		ports.setSettingsBusy("subagents");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.subagents;
			return next;
		});
		try {
			await writeSubagentThinking(id, thinkingLevel, entry.thinkingScope, {
				cwd: ports.cwd,
			});
			await refreshSubagentModels();
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				subagents: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const selectedSubagentModelEntry = () =>
		ports
			.subagentModelEntries()
			.find((entry) => entry.id === ports.selectedSubagentModelId());
	const subagentListRows = (): ExtensionSettingRow[] =>
		ports.subagentModelEntries().map((entry) => ({
			id: entry.id,
			label: entry.kind === "defaults" ? "Defaults" : entry.id,
			summary: [
				entry.model ?? "no model",
				entry.thinking ? `thinking ${entry.thinking}` : "",
				entry.source ?? "",
			]
				.filter(Boolean)
				.join(" · "),
		}));
	const subagentSettingsRows = (): ExtensionSettingRow[] => {
		const entry = selectedSubagentModelEntry();
		if (!entry) return [];
		return [
			{
				id: "model",
				label: "Model",
				summary: `${entry.model ?? "no model"}${entry.source ? ` · ${entry.source}` : ""}`,
			},
			{
				id: "thinking",
				label: "Thinking level",
				summary: `${entry.thinking ?? "default"}${entry.thinkingSource ? ` · ${entry.thinkingSource}` : ""}`,
			},
		];
	};
	const compactionSettingsRows = (): ExtensionSettingRow[] => {
		const state = ports.compactionModelState();
		if (!state) return [];
		const laneNote = (audit?: string, execution?: string): string =>
			audit && execution
				? "audit+execution lanes override"
				: audit
					? "audit lane overrides"
					: execution
						? "execution lane overrides"
						: "";
		const modelLane = laneNote(
			state.laneModels.audit,
			state.laneModels.execution,
		);
		const effective = state.effectiveThinking;
		const thinkingSummary =
			effective.audit === effective.execution
				? `${effective.audit} · both lanes`
				: `audit ${effective.audit} · execution ${effective.execution}`;
		return [
			{
				id: "model",
				label: "Model",
				summary: [state.model ?? "extension default", state.scope, modelLane]
					.filter(Boolean)
					.join(" · "),
			},
			{
				id: "thinking",
				label: "Thinking level",
				summary: [thinkingSummary, state.thinkingScope]
					.filter(Boolean)
					.join(" · "),
			},
		];
	};
	const openCompactionThinking = async () => {
		if (await ensureExtensionModels("compaction"))
			ports.setSettingsRoute("compaction-thinking");
	};
	const openSubagentThinking = async () => {
		if (await ensureExtensionModels("subagents"))
			ports.setSettingsRoute("subagent-thinking");
	};
	const openCompactionSetting = (id: string) => {
		ports.setDetailSettingSelectedId(id);
		if (id === "model") void openCompactionModelPicker();
		else void openCompactionThinking();
	};
	const openSubagentSetting = (id: string) => {
		ports.setDetailSettingSelectedId(id);
		if (id === "model") void openSubagentModelPicker();
		else void openSubagentThinking();
	};
	const modelChoiceForRef = (
		value: string | undefined,
	): ModelChoice | undefined => {
		const ref = parseModelRef(value);
		if (!ref) return undefined;
		const matches = (model: ModelChoice) =>
			model.provider === ref.provider && model.id === ref.id;
		return (
			ports.modelOptions().find(matches) ?? ports.cachedModels()?.find(matches)
		);
	};
	const compactionModelChoice = () =>
		modelChoiceForRef(ports.compactionModelState()?.model);
	const subagentModelChoice = () =>
		modelChoiceForRef(selectedSubagentModelEntry()?.model);
	const compactionThinkingLevels = () =>
		compatibleThinkingLevels(compactionModelChoice());
	const subagentThinkingLevels = () =>
		compatibleThinkingLevels(subagentModelChoice());
	const thinkingContextFor = (
		model: string | undefined,
		current: string | undefined,
		levels: readonly string[],
		fallback: string,
	): string => {
		const shown = current ?? fallback;
		return [
			model ?? "extension default model",
			`current ${shown}`,
			levels.some((level) => level === shown)
				? ""
				: "not supported by this model",
		]
			.filter(Boolean)
			.join(" · ");
	};
	const compactionThinkingContext = () =>
		thinkingContextFor(
			ports.compactionModelState()?.model,
			ports.compactionModelState()?.thinkingLevel,
			compactionThinkingLevels(),
			"low",
		);
	const subagentThinkingContext = () => {
		const entry = selectedSubagentModelEntry();
		return thinkingContextFor(
			entry?.model,
			entry?.thinking,
			subagentThinkingLevels(),
			"default",
		);
	};
	const compactionModelContext = () => {
		const state = ports.compactionModelState();
		if (!state) return undefined;
		return [
			`Compaction: ${state.model ?? "extension default"}`,
			...(state.thinkingLevel ? [`thinking ${state.thinkingLevel}`] : []),
			state.scope,
		].join(" · ");
	};
	const subagentModelContext = () => {
		const entry = selectedSubagentModelEntry();
		if (!entry) return undefined;
		return [
			`${entry.kind === "defaults" ? "Defaults" : entry.id}: ${entry.model ?? "no model"}`,
			...(entry.thinking ? [`thinking ${entry.thinking}`] : []),
			entry.source ?? "unset",
		].join(" · ");
	};

	return {
		refreshCompactionModel,
		refreshSubagentModels,
		openCompactionSettings,
		openSubagentModels,
		openSubagentSettings,
		applyCompactionModel,
		applySubagentModel,
		applyCompactionThinking,
		applySubagentThinking,
		selectedSubagentModelEntry,
		subagentListRows,
		subagentSettingsRows,
		compactionSettingsRows,
		openCompactionSetting,
		openSubagentSetting,
		compactionThinkingLevels,
		subagentThinkingLevels,
		compactionThinkingContext,
		subagentThinkingContext,
		compactionModelContext,
		subagentModelContext,
	};
}
