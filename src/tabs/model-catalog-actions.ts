/** Bounded, shared model discovery and model-picker states. */
import type { Accessor, Setter } from "solid-js";
import type { Toast } from "../types.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import {
	type ModelChoice,
	normalizeModelChoices,
} from "../ui/model-selector.tsx";
import type { SettingsAction } from "../ui/settings-descriptors.ts";
import type { SettingsErrorMap } from "./extension-model-actions.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

let availableModelsCache: ModelChoice[] | undefined;
let availableModelsFetch: Promise<ModelChoice[]> | undefined;

export function setCachedAvailableModels(models: ModelChoice[]): void {
  availableModelsCache = models;
}

export function cachedAvailableModels(): readonly ModelChoice[] | undefined {
	return availableModelsCache;
}

export interface ModelCatalogPorts {
	activeRuntime: () => ConversationTabRuntime;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	setModelOptions: Setter<ModelChoice[]>;
	setModelListNotice: Setter<string | undefined>;
	setModelSelectorOpen: Setter<boolean>;
	modelSelectorLoading: Accessor<boolean>;
	setSettingsBusy: Setter<SettingsAction | undefined>;
	setSettingsErrors: Setter<SettingsErrorMap>;
	setModelSelectorLoading: Setter<boolean>;
	setSettingsRoute: Setter<SettingsRoute>;
}

export interface ModelCatalogActions {
	fetchAvailableModels: () => Promise<ModelChoice[]>;
	loadModels: (fromSettings: boolean) => Promise<boolean>;
}

export function createModelCatalogActions(
	ports: ModelCatalogPorts,
): ModelCatalogActions {
	const fetchAvailableModels = (): Promise<ModelChoice[]> => {
		if (availableModelsFetch) return availableModelsFetch;
		availableModelsFetch = (async () => {
			const models = normalizeModelChoices(
				await ports.activeRuntime().client.getAvailableModels(),
			);
			if (!models.length) throw new Error("Pi returned no available models");
			availableModelsCache = models;
			return models;
		})().finally(() => {
			availableModelsFetch = undefined;
		});
		return availableModelsFetch;
	};
	const loadModels = async (fromSettings: boolean): Promise<boolean> => {
		if (!ports.activeRuntime().startupResolved) {
			ports.toast("This tab is still starting…", "info");
			return false;
		}
		if (!fromSettings) {
			// Open immediately so Ctrl+P never hangs on a slow Pi, then sync
			// visibly: the notice shows syncing/sync-failed instead of silently
			// serving a stale cached list.
			ports.setModelOptions(availableModelsCache ?? []);
			ports.setModelListNotice(
				availableModelsCache ? "syncing with Pi…" : "loading models from Pi…",
			);
			ports.setModelSelectorOpen(true);
			try {
				ports.setModelOptions(await fetchAvailableModels());
				ports.setModelListNotice(undefined);
			} catch (error) {
				if (!availableModelsCache) {
					ports.setModelSelectorOpen(false);
					ports.toast(
						`Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return false;
				}
				ports.setModelListNotice("sync failed — showing cached list");
			}
			return true;
		}
		if (ports.modelSelectorLoading()) return false;
		if (fromSettings) {
			ports.setSettingsBusy("model");
			ports.setSettingsErrors((errors) => {
				const next = { ...errors };
				delete next.model;
				return next;
			});
		}
		ports.setModelSelectorLoading(true);
		try {
			const models = await fetchAvailableModels();
			ports.setModelOptions(models);
			if (fromSettings) ports.setSettingsRoute("model");
			else ports.setModelSelectorOpen(true);
			return true;
		} catch (error) {
			if (fromSettings)
				ports.setSettingsErrors((errors) => ({
					...errors,
					model: error instanceof Error ? error.message : String(error),
				}));
			else
				ports.toast(
					`Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			return false;
		} finally {
			ports.setModelSelectorLoading(false);
			if (fromSettings) ports.setSettingsBusy(undefined);
		}
	};

	return { fetchAvailableModels, loadModels };
}
